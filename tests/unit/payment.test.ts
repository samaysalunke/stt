import { describe,it,expect } from 'vitest';
import { paymentState,paymentStateLabel } from '../../src/lib/payment';
describe('payment display state',()=>{
  it.each([[0,31000,10000,'unpaid'],[10000,31000,10000,'advance'],[15000,31000,10000,'part'],[31000,31000,10000,'full']])('%s paid is %s', (paid,total,advance,state)=>expect(paymentState(paid,total,advance)).toBe(state));
  it('uses the required labels',()=>expect(['unpaid','advance','part','full'].map(s=>paymentStateLabel(s as any))).toEqual(['Unpaid','Advance paid','Part paid','Fully paid']));
});
