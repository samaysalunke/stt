# Admin RBAC
# Feature branch: feature/rbac

---

## Depends on

- `feature/auth` — user identity, userId, socialIdentities

The RBAC system extends the existing user model. No separate auth stack. An admin is just a user with a role attached.

---

## 1. The problem

The admin panel is currently open — no authentication at all. Anyone with the URL can access it. This spec closes that gap and introduces roles so ops, trip leads, and owners have appropriately scoped access.

---

## 2. Role model

Three roles. Assign the minimum needed — nobody gets more than their job requires.

```
owner       Full access. Can do everything including managing roles.
            Zahra. One or two people max.

ops         Day-to-day operations. Verify payments, manage bookings,
            view registrations, mark trips confirmed/rejected.
            Cannot change trip content or manage roles.

trip_lead   Read-only access to the participant list for their
            assigned trips only. Name, WhatsApp number, room type.
            Cannot see other trips, payments, or admin settings.
```

### Role assignment

Roles are assigned manually by an `owner` from the admin panel. Not self-service. There is no sign-up flow for admin access.

A user must already have a user account (i.e. have logged in at least once via social login) before they can be assigned a role. You cannot grant a role to an email address alone — the userId must exist.

```
userRoles
  userId        (FK to user)
  role          (owner | ops | trip_lead)
  assignedBy    (userId of the owner who granted it)
  assignedAt
  tripIds       (array, only used for trip_lead role — scopes their access)
```

---

## 3. Admin login flow

1. User visits `/admin` (any route under `/admin/*`).
2. If no session: redirect to `/admin/login`.
3. `/admin/login` shows Google Sign In only (same provider as user auth). No separate admin credentials.
4. After social login, check `userRoles` for this userId.
5. **Role found:** admit to admin, redirect to the originally requested URL.
6. **No role found:** reject with a clean error page: `You don't have access to the admin panel. If you think this is a mistake, contact Zahra.` Do not reveal that the panel exists beyond this message.
7. No password, no OTP, no separate admin account. The social login is the credential.

### Session separation

Admin sessions should be scoped separately from user sessions. An `owner` browsing the public site as a normal user and then navigating to `/admin` triggers a fresh admin auth check — the user session alone is not sufficient. This prevents a stolen user cookie from granting admin access.

Implementation: set a separate `adminSessionToken` cookie on successful admin login, distinct from the user session cookie. Short expiry: 8 hours. Idle timeout: 2 hours of inactivity.

---

## 4. Permission matrix

| Action | owner | ops | trip_lead |
|---|---|---|---|
| View all bookings | ✓ | ✓ | — |
| View bookings for assigned trips only | ✓ | ✓ | ✓ |
| Verify / reject payments | ✓ | ✓ | — |
| Export participant list | ✓ | ✓ | ✓ (own trips only) |
| Edit trip content (YAML / CMS) | ✓ | — | — |
| Create / edit trips | ✓ | — | — |
| View all registrations (leads + pending) | ✓ | ✓ | — |
| Manage user roles | ✓ | — | — |
| View analytics / stats | ✓ | ✓ | — |
| Impersonate a user for support | ✓ | — | — |

---

## 5. Route protection (server-side, not just UI)

Every `/admin/*` route must be protected at the server/middleware level. The frontend hiding a button is not security — the API must enforce permissions.

Middleware on every admin route:
1. Validate `adminSessionToken`.
2. Resolve userId from token.
3. Look up role in `userRoles`.
4. Check the action against the permission matrix.
5. If any check fails: `403 Forbidden`. No redirect, no explanation beyond the status code, on API routes.

For `trip_lead` role: additionally check that `tripId` of the requested resource is in `userRoles.tripIds` for this user.

---

## 6. Audit log

Every write action in the admin panel is logged:

```
auditLog
  id
  actorUserId
  actorRole
  action          (e.g. booking.confirm, booking.reject, role.assign, trip.edit)
  targetType      (booking | user | trip | role)
  targetId
  previousValue   (JSON snapshot before)
  newValue        (JSON snapshot after)
  timestamp
  ipAddress
```

Read-only. The owner can view the audit log from the admin panel. It cannot be edited or deleted. Retention: indefinite (it's small data).

This protects against disputes: if a booking gets wrongly rejected or a role is unexpectedly changed, there is a timestamped record of who did it.

---

## 7. Ops-specific flows (what RBAC unlocks for the booking system)

These are the payment verification actions ops needs. They land on the same `pending` bookings from the pay-and-confirm flow.

**Verify payment:**
- Ops views a `pending` booking: name, trip, dates, tier, screenshot thumbnail.
- Taps `Confirm` → booking moves to `confirmed`. Seat is held. Confirmation sent to user via WhatsApp.
- Taps `Reject` → modal asks for reason (payment not found / screenshot unclear / other). Booking reverts to `lead`. Refund note is added. User notified via WhatsApp.

Both actions are logged in `auditLog`.

**View participant list:**
A per-trip view showing all `confirmed` bookings: name, WhatsApp number, room type, payment status. Exportable as CSV. `trip_lead` can access this for their trips only.

---

## 8. Role management UI (owner only)

A simple table under `/admin/settings/roles`:

```
User            Role         Trips (if lead)    Assigned by    Actions
Zahra S.        owner        —                  —              —
Prateek S.      trip_lead    Kashmir Jun        Zahra          [Remove]
[+ Add role]
```

`+ Add role` opens a form:
- Search by name or email (looks up existing user accounts)
- Select role
- If `trip_lead`: multi-select which trips they can see
- Confirm → writes to `userRoles`

Cannot demote or remove yourself. Cannot remove the last `owner`.

---

## 9. Edge cases

1. **User with a role is deleted / deactivates their account:** their `userRoles` row is also deleted. Access is revoked immediately on next request.
2. **Owner accidentally removes all owners:** blocked at the DB level — enforce at least one `owner` record at all times.
3. **Trip lead's assigned trip is deleted:** their `tripIds` entry becomes a dangling reference. Ignore gracefully — the trip just won't appear in their scoped view.
4. **Social provider token is compromised:** admin sessions have a 2-hour idle timeout and a separate cookie. Revoking a role takes effect on the next request — no need to invalidate active sessions instantly at this scale.
5. **Someone guesses the `/admin` URL:** they get the Google Sign In screen. If they authenticate but have no role, they see the "no access" message. The panel contents are never rendered.

---

## 10. What this is not

- Not a multi-tenant system. One STT organisation, one set of roles.
- Not a CMS permissions system. Keystatic CMS access is a separate concern (Railway/GitHub access), not managed here.
- Not a customer support system. `impersonate` is owner-only and not a v1 requirement — flag it but do not build it yet.
