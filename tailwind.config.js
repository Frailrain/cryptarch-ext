/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Rahool-inspired palette. Brand yellow is reserved for extension
        // icon + option-page header logo only; in-app accents use Rahool blue.
        // Exotic yellow is reserved for Exotic grade treatment.
        bg: {
          primary: '#0A0D12',
          card: '#161B22',
          border: '#23282F',
        },
        text: {
          primary: '#E8EAED',
          muted: '#8B95A1',
        },
        rahool: {
          blue: '#7FB3D5',
          yellow: '#D4A82C',
        },
        grade: {
          s: '#7C4DFF',
          a: '#7FB3D5',
          b: '#6B7280',
          exotic: '#CEAE33',
        },
      },
    },
  },
  plugins: [],
};
