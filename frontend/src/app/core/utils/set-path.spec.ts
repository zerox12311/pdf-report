import { setPath } from './set-path';

describe('setPath', () => {
  it('寫入單層與巢狀路徑', () => {
    const data: any = {};
    setPath(data, 'name', '王小明');
    setPath(data, 'customer.phone', '0912345678');
    expect(data.name).toBe('王小明');
    expect(data.customer.phone).toBe('0912345678');
  });

  it('寫入陣列索引路徑', () => {
    const data: any = {};
    setPath(data, 'items[0].name', '商品A');
    setPath(data, 'items[1].name', '商品B');
    setPath(data, 'items[0].qty', '2');
    expect(data.items.length).toBe(2);
    expect(data.items[0]).toEqual({ name: '商品A', qty: '2' });
    expect(data.items[1].name).toBe('商品B');
  });

  it('不覆蓋既有中間節點', () => {
    const data: any = { customer: { name: '既有' } };
    setPath(data, 'customer.phone', '02-12345678');
    expect(data.customer.name).toBe('既有');
    expect(data.customer.phone).toBe('02-12345678');
  });
});
