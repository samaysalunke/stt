export type PaymentState = 'unpaid' | 'advance' | 'part' | 'full';
export function paymentState(amountPaid: unknown, totalAmount: unknown, advanceAmount = 0): PaymentState {
  const paid=Number(amountPaid)||0, total=Number(totalAmount);
  if(paid<=0)return'unpaid';
  if(Number.isFinite(total)&&total>0&&paid>=total)return'full';
  if(advanceAmount>0&&paid===Math.min(advanceAmount,Number.isFinite(total)&&total>0?total:advanceAmount))return'advance';
  return'part';
}
export const paymentStateLabel=(state:PaymentState)=>({unpaid:'Unpaid',advance:'Advance paid',part:'Part paid',full:'Fully paid'}[state]);
