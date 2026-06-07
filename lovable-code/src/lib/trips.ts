import spiti from "@/assets/trip-spiti.jpg";
import meghalaya from "@/assets/trip-meghalaya.jpg";
import gokarna from "@/assets/trip-gokarna.jpg";
import ladakh from "@/assets/trip-ladakh.jpg";

export type TripStatus = "upcoming" | "filling_fast" | "sold_out";

export type Batch = {
  id: string;
  startDate: string;
  endDate: string;
  price: number;
  totalSpots: number;
  bookedSpots: number;
};

export type ItineraryDay = {
  day: number;
  title: string;
  description: string;
  stay?: string;
  meals?: string;
  transport?: string;
  note?: string;
};

export type Trip = {
  slug: string;
  title: string;
  shortDescription: string;
  longDescription: string;
  location: string;
  duration: string;
  status: TripStatus;
  coverImage: string;
  batches: Batch[];
  highlights: string[];
  itinerary: ItineraryDay[];
  included: string[];
  excluded: string[];
  important?: string;
  meetingPoint?: string;
  advanceAmount: number;
  groupSizeMax: number;
  registrationEnabled: boolean;
};

export const trips: Trip[] = [
  {
    slug: "spiti-valley-summer",
    title: "Spiti Valley — The cold desert run",
    shortDescription:
      "Nine days through monasteries, moonscapes, and the highest motorable villages in the world.",
    longDescription:
      "Spiti is quiet in a way that gets under your skin. We move slowly through Kaza, Langza, Komic and Hikkim — sleeping in homestays, eating thukpa with families who've lived above 4000m for generations. There's no Wi-Fi, the air is thin, and the stars at night look closer than they have any right to.",
    location: "Himachal Pradesh",
    duration: "9 days / 8 nights",
    status: "filling_fast",
    coverImage: spiti,
    advanceAmount: 3000,
    groupSizeMax: 14,
    registrationEnabled: true,
    batches: [
      { id: "spiti-jun", startDate: "15 Jun 2026", endDate: "23 Jun 2026", price: 32500, totalSpots: 14, bookedSpots: 10 },
      { id: "spiti-jul", startDate: "06 Jul 2026", endDate: "14 Jul 2026", price: 32500, totalSpots: 14, bookedSpots: 6 },
      { id: "spiti-aug", startDate: "10 Aug 2026", endDate: "18 Aug 2026", price: 34000, totalSpots: 14, bookedSpots: 2 },
    ],
    highlights: [
      "Sleeping in a 1000-year-old monastery village",
      "The post office at Hikkim — highest in the world",
      "A night around fire at Chandratal lake",
      "Crossing Kunzum Pass at 4,590m",
      "Tea with the headman of Komic",
      "Stargazing where there's zero light pollution",
    ],
    itinerary: [
      { day: 1, title: "Land in Shimla, drive to Narkanda", description: "We meet, we eat, we settle in. Early night.", stay: "Boutique homestay", meals: "D", transport: "Shared SUV" },
      { day: 2, title: "Narkanda → Sangla Valley", description: "First long drive. The Sutlej shows up. Apple orchards everywhere.", stay: "Riverside cottage", meals: "B, D" },
      { day: 3, title: "Sangla → Chitkul → Kalpa", description: "India's last village before the China border. Walk the apple trails.", stay: "Heritage hotel", meals: "B, L, D" },
      { day: 4, title: "Kalpa → Nako → Tabo", description: "We enter Spiti proper. Tabo monastery glows at dusk.", stay: "Monastery guesthouse", meals: "B, D" },
      { day: 5, title: "Tabo → Dhankar → Kaza", description: "A hanging monastery, a glacial lake hike for the bold.", stay: "Kaza homestay", meals: "B, L, D" },
      { day: 6, title: "Kaza loop — Langza, Hikkim, Komic", description: "Fossils, the highest post office, the highest village with a motorable road.", stay: "Kaza homestay", meals: "B, D" },
      { day: 7, title: "Kaza → Chandratal", description: "Camp by the moon lake. Bring layers — it gets cold.", stay: "Lake-side camp", meals: "B, L, D" },
      { day: 8, title: "Chandratal → Manali", description: "Over Kunzum and Rohtang. Long but unforgettable.", stay: "Manali boutique stay", meals: "B, D" },
      { day: 9, title: "Manali → Delhi (or onward)", description: "Goodbyes over breakfast. Trip ends post-noon.", meals: "B" },
    ],
    included: [
      "All stays (twin sharing, homestays + camps)",
      "All meals as per itinerary",
      "All inner-line permits",
      "Local SUV + driver across the loop",
      "Trip lead from Day 1 to Day 9",
      "Oxygen support at altitude",
    ],
    excluded: [
      "Flights / trains to Shimla and from Manali",
      "Personal expenses & tips",
      "Travel insurance (we'll recommend)",
      "Anything beyond the itinerary",
    ],
    important: "This is a high-altitude trip. We acclimatise slowly, but if you have heart, lung, or BP issues, please talk to us before booking.",
    meetingPoint: "Shimla Railway Station — 8:00 AM on Day 1",
  },
  {
    slug: "meghalaya-rainforest",
    title: "Meghalaya — Living roots & loud rain",
    shortDescription:
      "Six days of double-decker root bridges, the cleanest village in Asia, and Cherrapunji downpours.",
    longDescription:
      "Meghalaya doesn't try. The forests are denser than the map suggests, the rivers are unreasonably clear, and the people are some of the warmest you'll meet in this country. We trek to the double-decker root bridge, kayak in Dawki, and stay one night in Mawlynnong — the village they call the cleanest in Asia.",
    location: "Meghalaya",
    duration: "6 days / 5 nights",
    status: "upcoming",
    coverImage: meghalaya,
    advanceAmount: 3000,
    groupSizeMax: 12,
    registrationEnabled: true,
    batches: [
      { id: "meg-sep", startDate: "12 Sep 2026", endDate: "17 Sep 2026", price: 26500, totalSpots: 12, bookedSpots: 4 },
      { id: "meg-oct", startDate: "17 Oct 2026", endDate: "22 Oct 2026", price: 26500, totalSpots: 12, bookedSpots: 1 },
    ],
    highlights: [
      "Double-decker living root bridge trek",
      "Kayaking in glass-clear Dawki river",
      "A night in Mawlynnong",
      "Cherrapunji at full monsoon",
      "Local Khasi feast cooked by your host",
    ],
    itinerary: [
      { day: 1, title: "Land in Guwahati, drive to Shillong", description: "Settle in. Walk the police bazaar.", stay: "Shillong heritage stay", meals: "D" },
      { day: 2, title: "Shillong → Cherrapunji", description: "Living root bridges, Seven Sisters waterfall.", stay: "Cherrapunji eco-resort", meals: "B, D" },
      { day: 3, title: "Double-decker root bridge trek", description: "Long descent into Nongriat. Worth every step.", stay: "Nongriat guesthouse", meals: "B, L, D" },
      { day: 4, title: "Nongriat → Dawki", description: "Kayak on a river you can see through.", stay: "Dawki riverside camp", meals: "B, D" },
      { day: 5, title: "Dawki → Mawlynnong → Shillong", description: "The cleanest village. Bamboo skywalk.", stay: "Shillong", meals: "B, D" },
      { day: 6, title: "Shillong → Guwahati", description: "Trip ends by early afternoon.", meals: "B" },
    ],
    included: ["All stays", "All meals listed", "Local transport", "Trek guide for Nongriat", "Kayaking at Dawki"],
    excluded: ["Flights to Guwahati", "Personal expenses", "Insurance"],
  },
  {
    slug: "gokarna-beach-escape",
    title: "Gokarna — Beaches, not beach clubs",
    shortDescription: "A five-day reset on the quieter side of Karnataka's coast. No parties. Just water, salt and slow mornings.",
    longDescription:
      "If Goa is loud, Gokarna is what Goa was thirty years ago. We hop between five beaches, swim at sunrise, and eat fish curry off banana leaves. There's a yoga session if you want one, and a long boat ride at sunset that nobody regrets.",
    location: "Karnataka",
    duration: "5 days / 4 nights",
    status: "upcoming",
    coverImage: gokarna,
    advanceAmount: 3000,
    groupSizeMax: 16,
    registrationEnabled: true,
    batches: [
      { id: "gok-nov", startDate: "20 Nov 2026", endDate: "24 Nov 2026", price: 19500, totalSpots: 16, bookedSpots: 3 },
    ],
    highlights: ["Beach-hopping by foot and boat", "Sunrise yoga (optional)", "A long boat ride at golden hour", "Fish thali on a banana leaf"],
    itinerary: [
      { day: 1, title: "Arrive Gokarna", description: "Settle in at our beach stay. Sunset walk.", stay: "Om Beach cottage", meals: "D" },
      { day: 2, title: "Beach hop: Kudle + Om", description: "Two beaches, one path between them.", stay: "Om Beach cottage", meals: "B, L, D" },
      { day: 3, title: "Half-moon + Paradise beach", description: "Boat across, swim, eat.", stay: "Om Beach cottage", meals: "B, L, D" },
      { day: 4, title: "Yoga + temple walk", description: "Optional 7am yoga. Walk the old town.", stay: "Om Beach cottage", meals: "B, D" },
      { day: 5, title: "Goodbye breakfast", description: "Trip ends by 11 AM.", meals: "B" },
    ],
    included: ["Stay (4 nights)", "Meals as listed", "Boat rides", "Yoga session"],
    excluded: ["Travel to Gokarna", "Personal expenses"],
  },
  {
    slug: "ladakh-pangong-loop",
    title: "Ladakh — The Pangong loop",
    shortDescription: "Eight days on the high plateau. Leh, Nubra, Pangong. The blue lake you've seen in every photo.",
    longDescription:
      "Ladakh in person is bigger than any photo lets on. We start in Leh to acclimatise, ride double-humped camels in Nubra, and end at Pangong with a night under one of the clearest skies on Earth.",
    location: "Ladakh",
    duration: "8 days / 7 nights",
    status: "sold_out",
    coverImage: ladakh,
    advanceAmount: 3000,
    groupSizeMax: 12,
    registrationEnabled: false,
    batches: [
      { id: "lad-jul", startDate: "05 Jul 2026", endDate: "12 Jul 2026", price: 38000, totalSpots: 12, bookedSpots: 12 },
    ],
    highlights: ["Camels in Nubra", "A night at Pangong", "Magnetic Hill", "Hemis monastery"],
    itinerary: [
      { day: 1, title: "Land in Leh", description: "Rest. Hydrate. Acclimatise.", stay: "Leh boutique stay", meals: "D" },
      { day: 2, title: "Leh sightseeing", description: "Shanti Stupa, Leh Palace, walk the market.", stay: "Leh", meals: "B, D" },
      { day: 3, title: "Leh → Nubra via Khardung La", description: "World's highest motorable pass. Sand dunes by evening.", stay: "Nubra camp", meals: "B, L, D" },
      { day: 4, title: "Nubra → Pangong", description: "Long but stunning drive.", stay: "Pangong camp", meals: "B, L, D" },
      { day: 5, title: "Pangong → Leh", description: "Sunrise at the lake. Drive back via Chang La.", stay: "Leh", meals: "B, D" },
      { day: 6, title: "Sham Valley day trip", description: "Magnetic Hill, Gurudwara Pathar Sahib, confluence.", stay: "Leh", meals: "B, D" },
      { day: 7, title: "Hemis + Thiksey", description: "Two of Ladakh's most beautiful monasteries.", stay: "Leh", meals: "B, D" },
      { day: 8, title: "Fly out", description: "Trip ends.", meals: "B" },
    ],
    included: ["Stays", "Permits", "All meals listed", "Local SUV"],
    excluded: ["Flights", "Personal expenses"],
  },
];

export function getTrip(slug: string): Trip | undefined {
  return trips.find((t) => t.slug === slug);
}