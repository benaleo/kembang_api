/**
 * Constant-time string compare biar hasilnya tidak bocor lewat timing.
 *
 * Perbandingan `===` biasa berhenti di karakter pertama yang beda, jadi lama
 * eksekusinya berkorelasi dengan jumlah prefix yang benar — cukup untuk
 * menebak secret karakter per karakter. Fungsi ini selalu memeriksa seluruh
 * string.
 *
 * Catatan: panjang string tetap bocor (early return), dan itu memang trade-off
 * yang diterima — yang penting isinya tidak bisa ditebak bertahap.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
