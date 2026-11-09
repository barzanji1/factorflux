import compactNeumorphicShadows from "./client/src/styles/neu/compact-shadows.cjs";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

export default {
  plugins: [tailwindcss(), compactNeumorphicShadows(), autoprefixer()],
}
