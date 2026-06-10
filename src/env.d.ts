/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: {
      id: string;
      email: string;
      displayName: string | null;
      avatarUrl: string | null;
    } | null;
    adminUser: {
      userId: string;
      email: string;
      displayName: string | null;
      role: 'owner' | 'ops' | 'trip_lead';
      tripIds: string[];
    } | null;
  }
}
