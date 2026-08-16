export function generateInvoice(sequence: number, date: string, prefix: string = 'KEMBANGSELADANG'): string {
  const dateObj = new Date(date);
  const day = dateObj.getDate();
  const month = dateObj.getMonth() + 1;
  const year = dateObj.getFullYear();
  return `${sequence}-${day}/${month}/${year}/${prefix}`;
}
