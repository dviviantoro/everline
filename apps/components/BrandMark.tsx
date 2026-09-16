// The source PNG is a solid-black glyph on a transparent background, so it's
// used as a CSS mask and tinted with the brand amber color instead of being
// rendered as-is (which would be nearly invisible on the dark "ink" bg).
export function BrandMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="EverLine"
      className={`${className} inline-block shrink-0 bg-amber`}
      style={{
        WebkitMaskImage: "url(/logo.png)",
        maskImage: "url(/logo.png)",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}
