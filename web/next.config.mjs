/** @type {import('next').NextConfig} */

// Static export. Every page is a client component driven by the wallet and the
// chain, so there is no server to run: the whole app is files. That keeps the
// demo URL cheap to host, and means the judges' copy cannot break because a
// backend fell over.
//
// basePath is set when deploying to a GitHub Pages project site, where the app
// lives under /<repo> rather than at the root.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default {
  reactStrictMode: true,
  output: "export",
  basePath,
  images: { unoptimized: true },
  trailingSlash: true,
};
