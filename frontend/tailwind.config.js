/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        field: {
          50: '#f2f7f3',
          100: '#dfeade',
          500: '#3f7a4d',
          600: '#2f5f3b',
          700: '#24462d'
        },
        amber: {
          500: '#c98a1b'
        }
      }
    }
  },
  plugins: []
}
