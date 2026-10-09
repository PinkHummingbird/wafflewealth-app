# WaffleWealth — Privacy Policy

_Last updated: 27 September 2026_

**Contact: wafflewealth.app.support@gmail.com**

WaffleWealth projects your net worth from figures you type in yourself. Those figures are the most private thing an app can hold, and they stay on your iPhone. **We do not collect, transmit, sell, or share them.**

## Summary

- **No account. No sign-up.** You use WaffleWealth without ever creating one.
- **No servers of ours.** There is no backend. Nothing syncs anywhere.
- **No tracking, no ads, no analytics, no third-party SDKs.**
- **Exactly one network request exists, it is off until you switch it on, and it carries a three-letter currency code.** Never a balance, an amount, an account name, or a category.
- **App Privacy label: Data Not Collected.**
- **This website has a waitlist form.** It is the one place we hold an email address, only until the launch email is sent, and it concerns the website only. See [The waitlist on this website](#the-waitlist-on-this-website).

## Where your data lives

Your accounts, balances, categories, planned items, assumptions, target, markers and every figure derived from them are stored in a database on your iPhone. The file is written with iOS complete file protection, so it stays encrypted whenever the phone is locked.

The projection itself is never stored anywhere. It is recomputed from your own figures each time you look at it.

WaffleWealth uses one software library, GRDB, to read and write that local database. It runs on your device and sends nothing anywhere. There are no other third-party libraries of any kind.

## The one network request

WaffleWealth can fetch daily reference exchange rates, so that accounts held in different currencies can be shown in one. This is the only thing the app ever sends, and:

- **It is off when you install the app.** While it is off, WaffleWealth makes no network request at all. You turn it on yourself, in Assumptions, and you can turn it off again at any time.
- **The request is `GET https://open.er-api.com/v6/latest/{your base currency}`** — for example `.../v6/latest/AED`. The three-letter code is the entire request. There is no account, no key, no body, and no header that names you.
- **The host is `open.er-api.com`**, the open endpoint operated by ExchangeRate-API. What it receives is that currency code, and — as with any request to any website — the IP address your device is connecting from, which it necessarily sees in order to reply. Their handling of that request is governed by their own privacy policy.
- **No balance, amount, account name or category is ever transmitted**, because none of them is ever handed to the request in the first place.

You can leave the switch off permanently and type exchange rates in by hand. The app works exactly the same way.

## Export and backups

WaffleWealth can export your data as a file: a readable one, or an encrypted backup.

You choose where the file goes — iCloud Drive, another app, wherever you send it. Once it leaves the app it is yours to look after, and it is governed by whatever you sent it to.

An encrypted backup is sealed with a passphrase that only you hold. It is never stored in the app and never sent anywhere. **If you lose it, the backup cannot be opened — not by us, not by anyone.** That is the point of it, and it is not recoverable.

## The waitlist on this website

The homepage of this website has a form for being told when the app is out. It is the one place we hold anything about you, and it concerns the website only: the app itself works exactly as described above.

- **What is sent:** the email address you type. The form is handled by Formspree, Inc. on our behalf, so their servers also see what any web server sees when a browser sends a request: your IP address and browser details. Their handling of that is governed by [Formspree's privacy policy](https://formspree.io/legal/privacy-policy).
- **What it is used for:** one email telling you the app is available. Nothing else. No newsletter, no marketing, and it is not passed to anyone.
- **How long it is kept:** until that email has been sent. Then the address is deleted.
- **How to be removed sooner:** email **wafflewealth.app.support@gmail.com** and it will be deleted.

## What we do not do

- We do not collect analytics or usage data.
- We do not use advertising or third-party tracking.
- We do not sell or share your data with anyone.
- We do not require or offer an account, and we do not sync to the cloud.
- We do not connect to your bank, and we never ask for a banking credential.
- We do not include any third-party software development kits.

## Your control

- The exchange-rate switch is off by default and is yours to turn on or off at any time.
- You can export everything you have entered, at any time.
- **Deleting the app deletes everything.** Your database lives inside the app, so removing it removes your data from the device.

## Children

WaffleWealth is a general-audience app and is not directed at children. It does not knowingly collect data from anyone, because it does not collect data at all.

## Not financial advice

WaffleWealth reports figures and does not advise. It projects a line from the numbers you give it, and those numbers are assumptions, not predictions. Nothing in the app is a recommendation to save, spend, borrow or invest. For advice about your own circumstances, speak to someone qualified to give it.

## Changes

If this policy changes, the date at the top changes with it and the revised policy is posted at this URL.

## Contact

Questions about privacy: **wafflewealth.app.support@gmail.com**
