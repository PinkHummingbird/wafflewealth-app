# Bank layouts

Every folder here is one bank's export layout: the file as the bank lays it out, and
`expect.json` saying what reading it correctly gives. **Every file is made up**: the names,
numbers, places and lines are invented. Only the layout is the bank's: the columns and their
order, the header words, the separator, the quoting, the date and number format, the sign,
the rows above and below the table, and the text encoding.

Run the scoreboard, which reads each file the way the website reads an upload:

```
node statements/tests/corpus/run.mjs
node statements/tests/corpus/run.mjs --only uk/
```

`node --test statements/tests/corpus.test.mjs` fails if a layout marked `must_pass` stops
reading correctly.

## expect.json

```json
{
  "bank": "Barclays",
  "country": "GB",
  "product": "current account",
  "format": "csv",
  "file": "barclays.csv",
  "layout_sources": ["https://… (where the layout is documented)"],
  "layout_confidence": 80,
  "notes": "what is particular: no header row, rows above the table, Windows-1252, …",
  "must_pass": false,
  "expect": {
    "accounts": [
      {
        "currency": "GBP",
        "owed": false,
        "opening": null,
        "closing": 123456,
        "lines": [
          { "date": "2026-09-01", "amount": -1234, "text": "corner grocer" }
        ]
      }
    ]
  }
}
```

- Amounts are whole minor units (pence, cents). A line is **negative when money leaves the
  person** (a payment, a card purchase) and positive when it arrives (pay, a refund, paying off a
  card), whatever sign the bank prints.
- `currency: null` means the file names none: the reading should take the person's main
  currency, so the scoreboard does not check it.
- `opening` or `closing` `null` means the file does not give it; it is not checked.
- `text` is a few words the line's description must contain (case and spacing ignored).
- `layout_confidence` (0-100) is how sure we are that the layout matches the bank's real
  export, with `layout_sources` saying why.
