/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        rh: { red: '#EE0000', dark: '#1a1a2e' },
      },
      transitionProperty: {
        width: 'width',
      },
    },
  },
  plugins: [],
};
