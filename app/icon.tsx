import { ImageResponse } from 'next/og';

export const size = {
  width: 512,
  height: 512
};
export const contentType = 'image/png';

export default function Icon() {
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
          fontSize: 130,
          fontWeight: 700,
          borderRadius: 96
        }}
      >
        TR
      </div>
    ),
    size
  );
}
