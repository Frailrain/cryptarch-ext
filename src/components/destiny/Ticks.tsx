// Corner tick marks — 8 absolute-positioned spans (4 horizontal, 4 vertical)
// pinned to each corner of a relatively-positioned parent. Used as subtle
// framing on Panel cards. Gold-line color by default.

interface TicksProps {
  size?: number;
  color?: string;
}

export function Ticks({ size = 8, color = 'rgba(206,174,51,0.45)' }: TicksProps): JSX.Element {
  const h = { position: 'absolute' as const, width: size, height: 1, background: color };
  const v = { position: 'absolute' as const, width: 1, height: size, background: color };
  return (
    <>
      <span style={{ ...h, top: -1, left: -1 }} aria-hidden />
      <span style={{ ...v, top: -1, left: -1 }} aria-hidden />
      <span style={{ ...h, top: -1, right: -1 }} aria-hidden />
      <span style={{ ...v, top: -1, right: -1 }} aria-hidden />
      <span style={{ ...h, bottom: -1, left: -1 }} aria-hidden />
      <span style={{ ...v, bottom: -1, left: -1 }} aria-hidden />
      <span style={{ ...h, bottom: -1, right: -1 }} aria-hidden />
      <span style={{ ...v, bottom: -1, right: -1 }} aria-hidden />
    </>
  );
}
