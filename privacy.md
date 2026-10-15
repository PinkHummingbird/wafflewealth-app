# WaffleWealth — Privacy Policy

_Last updated: 15 October 2026 (the copy in iCloud now covers every input)_

**Contact: wafflewealth.app.support@gmail.com**

WaffleWealth projects your net worth from figures you type in yourself. Those figures are the most private thing an app can hold, and they stay on your iPhone unless you choose to keep a copy in your own iCloud. **We do not collect, sell, or share them, and we cannot see them.**

## Summary

- **No account. No sign-up.** You use WaffleWealth without ever creating one.
- **No servers of ours.** There is no backend, and we hold no copy of anything you enter.
- **iCloud is your choice, and it is off until you turn it on** (version 1.1 and later). Switched on, a copy goes to the private part of your own iCloud, which only you can read. See [The copy in your iCloud](#the-copy-in-your-icloud).
- **No tracking, no ads, no analytics, no third-party SDKs in the app.**
- **Exactly one network request exists, it is off until you switch it on, and it carries a three-letter currency code.** Never a balance, an amount, an account name, or a category.
- **App Privacy label: Data Not Collected.** Data in your own private iCloud is not collected by us: we have no way to read it.
- **This website had a waitlist form** before launch. Addresses given there are deleted once the launch email is sent. See [The waitlist on this website](#the-waitlist-on-this-website).
- **This website counts page visits** with GoatCounter, which sets no cookies and stores no personal data. The app counts nothing. See [Visits to this website](#visits-to-this-website).

## Where your data lives

Your accounts, balances, categories, planned items, assumptions, target, markers and every figure derived from them are stored in a database on your iPhone. The file is written with iOS complete file protection, so it stays encrypted whenever the phone is locked.

The projection itself is never stored anywhere. It is recomputed from your own figures each time you look at it.

WaffleWealth uses one software library, GRDB, to read and write that local database. It runs on your device and sends nothing anywhere. There are no other third-party libraries of any kind.

If your iPhone backs itself up to iCloud or to a computer, iOS includes the app's data in that backup, as it does for every app. That is your phone's own backup, handled by Apple and you. We never receive it and cannot read it.

## The copy in your iCloud

From version 1.1, WaffleWealth can keep a copy of everything you have put into it in your own iCloud, so that you can upload statements and make changes from a computer at [the web page](web/) and find them on your iPhone, and so that a new iPhone gets your whole file.

- **It is off when you install or update the app.** You turn it on yourself, in Settings › iCloud, and you can turn it off at any time.
- **Where it goes:** the private database of your own iCloud account, through Apple's CloudKit, in WaffleWealth's container. Only someone signed in with your Apple ID can read it. We, the developer, have no access to your private iCloud data.
- **What goes:** your accounts (names, currencies, categories and settings), the balances recorded for them, balances you took back, transactions, documents with their files, the statements you added (which file, which account each bank account became, and each line as the bank printed it), your income and spending and the other assumptions, planned items, your target, exchange rates, account groups, history marks, and the record of how your assumptions and rates changed over time. Whether the app fetches exchange rates is a setting of each iPhone and does not go. Nothing the app works out from these figures is stored anywhere: each device works it out again.
- **How it is protected:** Apple encrypts iCloud data in transit and at rest. If you use Advanced Data Protection, it is end-to-end encrypted, and the web page can reach it only if you turn on "Access iCloud Data on the Web" in your Apple ID settings. Apple's handling of iCloud data is described in [Apple's privacy policy](https://www.apple.com/legal/privacy/).
- **The web page** at `/web/` runs in your browser. You sign in with your Apple ID through Apple; we never see your password. The page loads Apple's CloudKit library and talks to Apple's iCloud servers and nothing else. It has no visit counter. A file you upload there goes into the same private database, in pieces of half a megabyte that your iPhone puts back together; it is never sent anywhere else. Statements you upload there are read by WaffleWealth on your iPhone, not on any server.
- **Turning it off** stops the copying and leaves the copy in iCloud as it is. **"Remove the copy from iCloud"** in Settings deletes everything WaffleWealth keeps there, including uploaded documents. Neither changes anything on your iPhone.
- **Notifications from iCloud** are silent: they tell the app something changed so it can fetch it, and carry no figures.

## Statements and documents

You can add bank statements (PDF, CSV or zip) and other files to WaffleWealth, from the Files app or, with iCloud on, from the web page. A statement is read on your iPhone, by the app itself; pages that are only pictures are read by iOS's own on-device text recognition. Nothing about a statement is sent anywhere to be read. Documents and what was read from statements are kept in the app with complete file protection, and in your iCloud only if the copy there is on.

## The one network request

WaffleWealth can fetch daily reference exchange rates, so that accounts held in different currencies can be shown in one. This is the only thing the app ever sends, and:

- **It is off when you install the app.** While it is off, WaffleWealth makes no network request at all. You turn it on yourself, under Income & spending, and you can turn it off again at any time.
- **The request is `GET https://open.er-api.com/v6/latest/{your base currency}`** — for example `.../v6/latest/AED`. The three-letter code is the entire request. There is no account, no key, no body, and no header that names you.
- **The host is `open.er-api.com`**, the open endpoint operated by ExchangeRate-API. What it receives is that currency code, and — as with any request to any website — the IP address your device is connecting from, which it necessarily sees in order to reply. Their handling of that request is governed by their own privacy policy.
- **No balance, amount, account name or category is ever transmitted**, because none of them is ever handed to the request in the first place.

You can leave the switch off permanently and type exchange rates in by hand. The app works exactly the same way.

## Export and backups

WaffleWealth can export your data as a file: a spreadsheet of your balances, a full file of everything you have entered, or an encrypted copy.

You choose where the file goes — iCloud Drive, another app, wherever you send it. Once it leaves the app it is yours to look after, and it is governed by whatever you sent it to.

An encrypted backup is sealed with a passphrase that only you hold. It is never stored in the app and never sent anywhere. **If you lose it, the backup cannot be opened — not by us, not by anyone.** That is the point of it, and it is not recoverable.

## Face ID lock and the monthly reminder

Both are off until you switch them on in Settings, and neither sends anything anywhere.

- **The lock** asks iOS to confirm it is you, with Face ID or your passcode. iOS does the checking. The app only learns yes or no, and never sees your face or your passcode.
- **The reminder** is a notification your iPhone schedules for itself, once a month. iOS asks your permission first. There is no server behind it and it contains no figures: it says "Time to update your balances".

## The waitlist on this website

Before launch, the homepage of this website had a form for being told when the app was out. It is the one place we hold anything about you, and it concerns the website only: the app itself works exactly as described above.

- **What is sent:** the email address you type. The form is handled by Formspree, Inc. on our behalf, so their servers also see what any web server sees when a browser sends a request: your IP address and browser details. Their handling of that is governed by [Formspree's privacy policy](https://formspree.io/legal/privacy-policy).
- **What it is used for:** one email telling you the app is available. Nothing else. No newsletter, no marketing, and it is not passed to anyone.
- **How long it is kept:** until that email has been sent. Then the address is deleted.
- **How to be removed sooner:** email **wafflewealth.app.support@gmail.com** and it will be deleted.

## Visits to this website

This website, and only this website, counts page visits with [GoatCounter](https://www.goatcounter.com), an open-source counter. It sets no cookies, does not track you across sites, and stores no personal data: it records which page was opened, the referring site, and broad details such as browser, screen size and country, worked out from the request and not kept with your IP address. We use the totals to see whether anyone is visiting. Their handling is described in [GoatCounter's privacy policy](https://www.goatcounter.com/help/privacy). Numbers you type into the demo never leave the page.

The home page and the demo load their typefaces from Google Fonts. To send the fonts, Google's servers see what any web server sees: your IP address and browser details. No cookies are set for it. Google's handling is described in the [Google Fonts privacy FAQ](https://developers.google.com/fonts/faq/privacy).

## What we do not do

- The app collects no analytics or usage data.
- We do not use advertising or third-party tracking.
- We do not sell or share your data with anyone.
- We do not require or offer an account. iCloud, if you turn it on, is your own Apple account, not ours.
- We do not connect to your bank, and we never ask for a banking credential.
- We do not include any third-party software development kits.

## Your control

- The exchange-rate switch is off by default and is yours to turn on or off at any time.
- You can export everything you have entered, at any time.
- **Deleting the app deletes everything on the device.** Your database lives inside the app, so removing it removes your data from the iPhone. If the iCloud copy is on, remove it first in Settings, or later in your iPhone's Settings › your name › iCloud › Manage Storage.

## Children

WaffleWealth is a general-audience app and is not directed at children. It does not knowingly collect data from anyone, because it does not collect data at all.

## Not financial advice

WaffleWealth reports figures and does not advise. It projects a line from the numbers you give it, and those numbers are assumptions, not predictions. Nothing in the app is a recommendation to save, spend, borrow or invest. For advice about your own circumstances, speak to someone qualified to give it.

## Changes

If this policy changes, the date at the top changes with it and the revised policy is posted at this URL.

## Contact

Questions about privacy: **wafflewealth.app.support@gmail.com**

<!-- Page visits on this website only, counted by GoatCounter: no cookies, no personal data. The app itself sends nothing. -->
<script data-goatcounter="https://pinkhummingbird.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>
