// Two made-up statements the page opens with, so it shows what it does before anything is
// added. The bank, the person and every figure are invented. They are laid out as rows and go
// through the same reading and checking as a real statement, by the plain-table reader.
import { rowsFromItems } from './readers.js';

const page = (rows, top = 760) =>
  rowsFromItems(rows.flatMap((cells, i) =>
    cells.map(([x, s]) => ({ x, y: top - i * 18, w: s.length * 4, h: 8, s }))));

const savings = [
  page([
    [[40, 'Harbourside Example Bank']],
    [[40, 'Sam Example'], [380, 'Statement 1 May 2026 to 31 May 2026']],
    [[40, 'Everyday Saver 0000 4471'], [380, 'Currency GBP']],
    [[40, 'Date'], [110, 'Details'], [330, 'Paid out'], [400, 'Paid in'], [470, 'Balance']],
    [[40, '01/05/2026'], [110, 'Opening balance'], [478, '2,140.00']],
    [[40, '02/05/2026'], [110, 'Rent, Flat 2'], [332, '1,250.00'], [480, '890.00']],
    [[40, '06/05/2026'], [110, 'Corner Grocer'], [340, '64.20'], [480, '825.80']],
    [[40, '14/05/2026'], [110, 'Sam Example to Rainy Day Pot'], [335, '300.00'], [480, '525.80']],
    [[40, '20/05/2026'], [110, 'Card repayment'], [335, '412.35'], [480, '113.45']],
    [[40, '28/05/2026'], [110, 'Pay from Example Studio Ltd'], [400, '3,350.00'], [472, '3,463.45']],
    [[40, '31/05/2026'], [110, 'Interest earned'], [412, '1.12'], [472, '3,464.57']],
    [[40, '31/05/2026'], [110, 'Closing balance'], [472, '3,464.57']],
  ]),
];

const card = [
  page([
    [[40, 'Harbourside Example Bank card'], [380, 'Credit limit 5,000.00']],
    [[40, 'Sam Example'], [380, 'Statement date 25 May 2026']],
    [[40, 'Card XXXX XXXX XXXX 2210']],
    [[40, 'Date'], [110, 'Description'], [470, 'Amount (GBP)']],
    [[40, '26 Apr'], [110, 'Previous balance'], [478, '412.35']],
    [[40, '29 Apr'], [110, 'Station Coffee'], [482, '3.40']],
    [[40, '03 May'], [110, 'Bookshop on the Quay'], [478, '18.99']],
    [[40, '11 May'], [110, 'Hotel Nord, Copenhagen'], [474, '214.60']],
    [[40, '12 May'], [110, 'Return, Bookshop on the Quay'], [478, '18.99CR']],
    [[40, '24 May'], [110, 'Train tickets'], [480, '46.80']],
    [[40, '25 May'], [110, 'New balance'], [478, '677.15']],
  ]),
];

export const SAMPLES = [
  { fileName: 'example-saver-may-2026.pdf', holder: 'Sam Example', pages: savings },
  { fileName: 'example-card-may-2026.pdf', holder: 'Sam Example', pages: card },
];
