import { fetchCafeteriaMenu, formatMenu } from "../src/cafeteria.mjs";

const ymd = process.argv[2] || "20260608";
const mealType = process.argv[3] || "LN";
const result = await fetchCafeteriaMenu({ ymd, mealType });

console.log(formatMenu(result));
