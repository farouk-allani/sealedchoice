import Image from "next/image";

const artwork = ["brief", "scoring", "committee", "review"] as const;

/** Cycles stills illustrate the step; the adjacent form supplies all real tender data. */
export function CreationArtwork({ step }: { step: number }) {
  const asset = artwork[step] ?? artwork[0];
  return (
    <figure className="create-artwork" aria-hidden="true" data-step={asset}>
      <Image
        src={`/visuals/blender/create-${asset}-poster.webp`}
        width={960}
        height={720}
        alt=""
        loading="eager"
        unoptimized
      />
    </figure>
  );
}
