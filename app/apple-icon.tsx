import { ImageResponse } from 'next/og';

export const size = {
  width: 180,
  height: 180
};
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#0f1a1d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#d8fff1',
          fontSize: 64,
          fontWeight: 700,
          borderRadius: 36
        }}
      >
        TR
      </div>
    ),
    size
  );
}
