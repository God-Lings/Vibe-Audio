/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/renderer/index.html",
    "./src/renderer/src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      keyframes: {
        'warp-2d': {
          '0%': { transform: 'translateY(0) scale(0.2)', opacity: '0' },
          '20%': { opacity: '1' },
          '80%': { opacity: '1' },
          '100%': { transform: 'translateY(-70vh) scale(3)', opacity: '0' }
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' }
        },
        'dj-glow': {
          '0%, 100%': { transform: 'scale(1)', boxShadow: '0 0 10px rgba(29,185,84,0.4)' },
          '50%': { transform: 'scale(1.05)', boxShadow: '0 0 20px rgba(29,185,84,0.8)' }
        },
        'dj-bounce': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-2px)' }
        }
      },
      animation: {
        'warp-2d': 'warp-2d linear infinite',
        float: 'float 3s ease-in-out infinite',
        'dj-glow': 'dj-glow 2s ease-in-out infinite',
        'dj-bounce': 'dj-bounce 0.6s ease-in-out infinite'
      }
    }
  },
  plugins: []
}