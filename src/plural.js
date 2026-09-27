// "1 chapter", "2 chapters": counts in report lines agree with their noun.
export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

// Whole-number percentages of `values` that add up to 100 (largest
// remainder), so three equal shares print as 34, 33, 33 rather than 33 each.
export function roundedShares(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return values.map(() => 0);
  }
  const exact = values.map((value) => (value * 100) / total);
  const shares = exact.map(Math.floor);
  let left = 100 - shares.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) {
      break;
    }
    shares[index] += 1;
    left -= 1;
  }
  return shares;
}
