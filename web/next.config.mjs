/** @type {import('next').NextConfig} */
const config = {
  transpilePackages: [
    'react-markdown',
    'remark-gfm',
    'vfile',
    'unist-util-visit',
    'three',
    '@react-three/fiber',
    '@react-three/drei',
  ],
};

export default config;
