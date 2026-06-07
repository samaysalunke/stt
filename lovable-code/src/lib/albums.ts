import spiti from "@/assets/trip-spiti.jpg";
import meghalaya from "@/assets/trip-meghalaya.jpg";
import gokarna from "@/assets/trip-gokarna.jpg";
import ladakh from "@/assets/trip-ladakh.jpg";

export type AlbumPhoto = {
  url: string;
  /** Tailwind aspect helper, e.g. "aspect-[3/4]" for masonry variety. */
  aspect?: string;
  /** Render a play-icon overlay (decorative — implies a video clip). */
  video?: boolean;
};

export type Album = {
  slug: string;
  title: string;
  subtitle: string;
  cover: string;
  days: number;
  date: string;
  photos: AlbumPhoto[];
};

export const albums: Album[] = [
  {
    slug: "ladakh",
    title: "Ladakh",
    subtitle: "Across High Passes",
    cover: ladakh,
    days: 8,
    date: "September 2025",
    photos: [
      { url: "https://images.unsplash.com/photo-1589308078059-be1415eab4c3?w=800&q=80", aspect: "aspect-[4/5]" },
      { url: "https://images.unsplash.com/photo-1606318801954-d46d46d3360a?w=800&q=80", aspect: "aspect-[3/4]" },
      { url: "https://images.unsplash.com/photo-1605649487212-47bdab064df7?w=800&q=80", aspect: "aspect-[4/5]", video: true },
      { url: "https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?w=800&q=80", aspect: "aspect-[3/4]" },
      { url: "https://images.unsplash.com/photo-1589308454676-21178b2c3e84?w=800&q=80", aspect: "aspect-square" },
      { url: "https://images.unsplash.com/photo-1582719471384-894fbb16e074?w=800&q=80", aspect: "aspect-[3/4]", video: true },
      { url: "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&q=80", aspect: "aspect-[4/5]" },
      { url: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80", aspect: "aspect-[3/4]" },
    ],
  },
  {
    slug: "spiti-valley",
    title: "Spiti Valley",
    subtitle: "The High-Desert Souls",
    cover: spiti,
    days: 7,
    date: "July 2024",
    photos: [
      { url: "https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?w=800&q=80", aspect: "aspect-[4/5]" },
      { url: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800&q=80", aspect: "aspect-[3/4]" },
      { url: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80", aspect: "aspect-[3/4]", video: true },
      { url: "https://images.unsplash.com/photo-1454496522488-7a8e488e8606?w=800&q=80", aspect: "aspect-[4/5]" },
      { url: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80", aspect: "aspect-square" },
      { url: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800&q=80", aspect: "aspect-[3/4]" },
    ],
  },
  {
    slug: "ziro-valley",
    title: "Ziro Valley",
    subtitle: "Mist & Music",
    cover: meghalaya,
    days: 6,
    date: "March 2024",
    photos: [
      { url: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=800&q=80", aspect: "aspect-[4/5]" },
      { url: "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&q=80", aspect: "aspect-[3/4]" },
      { url: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&q=80", aspect: "aspect-[3/4]" },
      { url: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=800&q=80", aspect: "aspect-square", video: true },
      { url: "https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=800&q=80", aspect: "aspect-[4/5]" },
      { url: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=800&q=80", aspect: "aspect-[3/4]" },
    ],
  },
  {
    slug: "gokarna",
    title: "Gokarna",
    subtitle: "Salt, Sand & Sunsets",
    cover: gokarna,
    days: 5,
    date: "November 2024",
    photos: [
      { url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80", aspect: "aspect-[4/5]" },
      { url: "https://images.unsplash.com/photo-1519046904884-53103b34b206?w=800&q=80", aspect: "aspect-[3/4]" },
      { url: "https://images.unsplash.com/photo-1505228395891-9a51e7e86bf6?w=800&q=80", aspect: "aspect-square" },
      { url: "https://images.unsplash.com/photo-1473116763249-2faaef81ccda?w=800&q=80", aspect: "aspect-[3/4]", video: true },
      { url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80", aspect: "aspect-[4/5]" },
      { url: "https://images.unsplash.com/photo-1519046904884-53103b34b206?w=800&q=80", aspect: "aspect-[3/4]" },
    ],
  },
];

export function getAlbum(slug: string): Album | undefined {
  return albums.find((a) => a.slug === slug);
}