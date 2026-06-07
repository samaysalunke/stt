import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Share2, Play } from "lucide-react";
import { getAlbum, type Album } from "@/lib/albums";

export const Route = createFileRoute("/photo-vault/$album")({
  loader: ({ params }) => {
    const album = getAlbum(params.album);
    if (!album) throw notFound();
    return { album };
  },
  head: ({ loaderData }) => ({
    meta: loaderData?.album
      ? [
          { title: `${loaderData.album.title} — The Vault` },
          { name: "description", content: loaderData.album.subtitle },
          { property: "og:title", content: `${loaderData.album.title} — The Vault` },
          { property: "og:description", content: loaderData.album.subtitle },
          { property: "og:image", content: loaderData.album.cover },
        ]
      : [],
  }),
  component: AlbumDetail,
});

function AlbumDetail() {
  const { album } = Route.useLoaderData() as { album: Album };
  const router = useRouter();

  const handleBack = (e: React.MouseEvent) => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      e.preventDefault();
      router.history.back();
    }
  };

  return (
    <main className="bg-[color:var(--cream,#faf6f1)] min-h-screen">
      {/* Top bar */}
      <header className="mx-auto flex max-w-2xl items-center justify-between px-5 pt-5">
        <Link
          to="/photo-vault"
          onClick={handleBack}
          aria-label="Back"
          className="grid h-9 w-9 place-items-center rounded-full text-[color:var(--navy)] hover:bg-[color:var(--blush)]"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="text-[11px] uppercase tracking-[0.25em] text-[color:var(--navy)]/55">
          by <span className="font-display italic text-[color:var(--coral)]">Zahra</span>
        </span>
        <button
          aria-label="Share"
          className="grid h-9 w-9 place-items-center rounded-full text-[color:var(--navy)] hover:bg-[color:var(--blush)]"
        >
          <Share2 className="h-4 w-4" />
        </button>
      </header>

      {/* Title block */}
      <section className="mx-auto max-w-2xl px-5 pt-8 pb-6">
        <h1 className="font-display text-[3rem] leading-[1] text-[color:var(--navy)]">
          {album.title}
        </h1>
        <p className="mt-2 font-display text-lg italic text-[color:var(--coral)]">
          {album.subtitle}
        </p>
      </section>

      {/* Masonry grid */}
      <section className="mx-auto max-w-2xl px-5">
        <div className="columns-2 gap-3 [column-fill:_balance]">
          {album.photos.map((p, i) => (
            <figure
              key={i}
              className={
                "mb-3 break-inside-avoid overflow-hidden rounded-xl bg-[color:var(--blush)] " +
                (p.aspect ?? "aspect-[3/4]")
              }
            >
              <div className="relative h-full w-full">
                <img
                  src={p.url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                {p.video && (
                  <span
                    aria-hidden
                    className="absolute inset-0 grid place-items-center"
                  >
                    <span className="grid h-12 w-12 place-items-center rounded-full bg-white/85 text-[color:var(--navy)] shadow-md backdrop-blur-sm">
                      <Play className="h-5 w-5 translate-x-[1px] fill-current" />
                    </span>
                  </span>
                )}
              </div>
            </figure>
          ))}
        </div>
      </section>

      {/* End of vault */}
      <section className="mx-auto max-w-2xl px-5 py-16 text-center">
        <p className="text-[10px] uppercase tracking-[0.3em] text-[color:var(--navy)]/45">
          End of Vault
        </p>
        <span
          aria-hidden
          className="mx-auto mt-3 block h-[2px] w-10 rounded-full"
          style={{ background: "var(--coral)" }}
        />
      </section>

      {/* Footer */}
      <footer className="mx-auto max-w-2xl px-5 pb-10 text-center">
        <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--navy)]/45">
          Curated by Zahra © 2026
        </p>
      </footer>
    </main>
  );
}