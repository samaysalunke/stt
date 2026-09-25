import { describe,it,expect } from 'vitest';
import { paymentState } from '../../src/lib/payment';
describe('payment display state',()=>{
  it.each([[0,31000,10000,'unpaid'],[10000,31000,10000,'advance'],[15000,31000,10000,'part'],[31000,31000,10000,'full']])('%s paid is %s', (paid,total,advance,state)=>expect(paymentState(paid,total,advance)).toBe(state));
});
