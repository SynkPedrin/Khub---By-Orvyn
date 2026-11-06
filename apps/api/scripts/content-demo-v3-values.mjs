// User-approved allocation. Integer centavos avoid floating-point drift.
// Input for V3 migration; importing this file does not change the database.
export const vittaSales = Object.freeze({
  naturalidade: Object.freeze([320000, 290000, 320000, 490000]),
  informacao: Object.freeze([410000, 340000]),
  agenda: Object.freeze([]),
});
const sum = values => values.reduce((a,b)=>a+b,0);
if (sum(vittaSales.naturalidade)!==1420000 || sum(vittaSales.informacao)!==750000 || sum(Object.values(vittaSales).flat())!==2170000) {
  throw new Error('Inconsistent Vitta V3 allocation');
}
