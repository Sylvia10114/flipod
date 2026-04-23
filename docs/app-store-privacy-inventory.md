# Flipod App Store Privacy Inventory

Last updated: 2026-04-22

This document is a code-based draft for Flipod's App Store privacy labels and privacy policy work. It is intentionally conservative where the code suggests a real possibility of collection.

It is not legal advice.

## Status

- Recommended answer for Tracking: `No`
- Recommended starting point for App Privacy in App Store Connect: `Yes, we collect data from this app`
- Privacy policy URL is required before App Store submission
- Current iOS privacy manifest still has an empty `NSPrivacyCollectedDataTypes` array: [mobile/ios/Flipod/PrivacyInfo.xcprivacy](/Users/nathanshan/Desktop/flipod_jp_sync/mobile/ios/Flipod/PrivacyInfo.xcprivacy:43)

## Apple rules this draft is based on

- Apple says App Store Connect privacy answers must cover your app and third-party partners whose code is integrated into the app.
- Apple defines "collect" as transmitting data off device in a way that lets you or partners access it for longer than needed to service the request in real time.
- Apple requires a public privacy policy URL for iOS apps.

Official sources:

- [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)
- [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)

## High-confidence data types to disclose

These are the safest starting answers based on the current code and schema.

### 1. Contact Info: Phone Number

Recommended label:

- Collected: `Yes`
- Linked to user: `Yes`
- Used for tracking: `No`
- Purposes:
  - `App Functionality`

Why:

- SMS login collects and verifies phone numbers: [mobile/src/services/api.ts](/Users/nathanshan/Desktop/flipod_jp_sync/mobile/src/services/api.ts:110)
- Phone numbers are stored in `sms_challenges`: [db/schema.sql](/Users/nathanshan/Desktop/flipod_jp_sync/db/schema.sql:101)
- Phone identity can be linked to an account: [functions/api/auth/link/phone.js](/Users/nathanshan/Desktop/flipod_jp_sync/functions/api/auth/link/phone.js:1)

### 2. Identifiers: User ID

Recommended label:

- Collected: `Yes`
- Linked to user: `Yes`
- Used for tracking: `No`
- Purposes:
  - `App Functionality`

Why:

- Server creates and stores account-level user IDs: [db/schema.sql](/Users/nathanshan/Desktop/flipod_jp_sync/db/schema.sql:1)
- Auth sessions are tied to `user_id`: [db/schema.sql](/Users/nathanshan/Desktop/flipod_jp_sync/db/schema.sql:89)
- Linked identities are tied to `user_id`: [db/schema.sql](/Users/nathanshan/Desktop/flipod_jp_sync/db/schema.sql:77)

### 3. Usage Data: Product Interaction

Recommended label:

- Collected: `Yes`
- Linked to user: `Yes`
- Used for tracking: `No`
- Purposes:
  - `App Functionality`
  - `Product Personalization`

Why:

- Bookmarks are stored per user: [db/schema.sql](/Users/nathanshan/Desktop/flipod_jp_sync/db/schema.sql:19)
- Likes are stored per user: [db/schema.sql](/Users/nathanshan/Desktop/flipod_jp_sync/db/schema.sql:133)
- Practice progress is stored per user: [db/schema.sql](/Users/nathanshan/Desktop/flipod_jp_sync/db/schema.sql:113)
- Event data is stored per user: [db/schema.sql](/Users/nathanshan/Desktop/flipod_jp_sync/db/schema.sql:59)
- The app tells users liked clips affect recommendations: [mobile/src/i18n/ui-copy.json](/Users/nathanshan/Desktop/flipod_jp_sync/mobile/src/i18n/ui-copy.json:26)

## Likely data types to disclose unless you intentionally reduce them

These are the categories I would disclose today unless you want to refactor before launch.

### 4. Contact Info: Email Address

Recommended label:

- Collected: `Yes`
- Linked to user: `Yes`
- Used for tracking: `No`
- Purposes:
  - `App Functionality`

Why:

- Apple identity verification extracts email from the token payload: [functions/_lib/apple.js](/Users/nathanshan/Desktop/flipod_jp_sync/functions/_lib/apple.js:92)
- Apple sign-in stores `name || tokenPayload.email || 'Apple'` in `provider_display`: [functions/api/auth/apple.js](/Users/nathanshan/Desktop/flipod_jp_sync/functions/api/auth/apple.js:38)
- `provider_display` is persisted in `user_identities`: [functions/_lib/session.js](/Users/nathanshan/Desktop/flipod_jp_sync/functions/_lib/session.js:287)

If you do not want to disclose email address, you should stop storing the Apple email in `provider_display`.

### 5. Contact Info: Name

Recommended label:

- Collected: `Yes`
- Linked to user: `Yes`
- Used for tracking: `No`
- Purposes:
  - `App Functionality`

Why:

- Apple sign-in can send `name`, and the backend stores it in `provider_display`: [functions/api/auth/apple.js](/Users/nathanshan/Desktop/flipod_jp_sync/functions/api/auth/apple.js:18)
- The stored display value is persisted in `user_identities`: [functions/_lib/session.js](/Users/nathanshan/Desktop/flipod_jp_sync/functions/_lib/session.js:288)

If you do not want to disclose name, you should stop persisting the Apple name.

### 6. Identifiers: Device ID

Recommended label:

- Collected: `Yes`
- Linked to user: `Yes`
- Used for tracking: `No`
- Purposes:
  - `App Functionality`

Why:

- The app creates and stores a persistent device identifier locally: [mobile/src/storage.ts](/Users/nathanshan/Desktop/flipod_jp_sync/mobile/src/storage.ts:20)
- The device ID is sent to the backend in auth and session flows: [mobile/src/services/api.ts](/Users/nathanshan/Desktop/flipod_jp_sync/mobile/src/services/api.ts:104)
- The backend stores device-to-user mappings: [db/schema.sql](/Users/nathanshan/Desktop/flipod_jp_sync/db/schema.sql:69)

Note:

- This one is slightly gray because it is an app-generated identifier, not Apple's advertising ID.
- My recommendation is still to disclose it conservatively because it functions as a persistent device-level identifier in your system.

### 7. User Content: Other User Content

Recommended label:

- Collected: `Likely yes`
- Linked to user: `Yes`
- Used for tracking: `No`
- Purposes:
  - `App Functionality`
  - `Product Personalization`

Why:

- Profile preferences are stored server-side, including level, interests, native language, theme, onboarding: [functions/api/profile.js](/Users/nathanshan/Desktop/flipod_jp_sync/functions/api/profile.js:24)
- Saved vocab entries include word, phonetic, definitions, context, and context translations: [db/schema.sql](/Users/nathanshan/Desktop/flipod_jp_sync/db/schema.sql:31)
- Local session data can be merged into an authenticated account: [functions/api/auth/migrate-local.js](/Users/nathanshan/Desktop/flipod_jp_sync/functions/api/auth/migrate-local.js:25)

Note:

- Apple’s category definitions can make this one judgment-based.
- If you want the leanest possible label, you could choose to disclose only `Product Interaction` and not `Other User Content`.
- If you want the safest possible label, include it.

## Data types I do not currently recommend disclosing

Based on the current code, I do not see a strong reason to mark these as collected:

- `Location`
- `Contacts`
- `Browsing History`
- `Search History`
- `Purchases`
- `Crash Data`
- `Performance Data`
- `Other Diagnostic Data`
- `Advertising Data`
- `Health`
- `Financial Info`
- `Sensitive Info`

## Tracking recommendation

Recommended answer:

- `No, we do not use data for tracking`

Why:

- I do not see ad SDKs or attribution SDKs in [mobile/package.json](/Users/nathanshan/Desktop/flipod_jp_sync/mobile/package.json:1)
- I do not see code paths that share app data with ad networks or data brokers
- I do not see evidence of cross-app or cross-company ad measurement

## Third-party services to mention in the privacy policy

These may not all become separate App Store label rows, but they should appear in the privacy policy.

- `Apple Sign In`
  - identity verification for Apple login: [functions/_lib/apple.js](/Users/nathanshan/Desktop/flipod_jp_sync/functions/_lib/apple.js:1)
- `Aliyun SMS`
  - SMS verification delivery: [functions/_lib/sms.js](/Users/nathanshan/Desktop/flipod_jp_sync/functions/_lib/sms.js:116)
- `Azure OpenAI`
  - content translation and practice generation: [functions/_lib/content-translations.js](/Users/nathanshan/Desktop/flipod_jp_sync/functions/_lib/content-translations.js:64), [functions/api/practice/generate.js](/Users/nathanshan/Desktop/flipod_jp_sync/functions/api/practice/generate.js:64)
- `ElevenLabs`
  - TTS generation: [functions/api/tts.js](/Users/nathanshan/Desktop/flipod_jp_sync/functions/api/tts.js:19)
- `Google Translate public endpoint`
  - client-side word lookup: [mobile/src/components/WordPopup.tsx](/Users/nathanshan/Desktop/flipod_jp_sync/mobile/src/components/WordPopup.tsx:62), [mobile/src/word-translation.ts](/Users/nathanshan/Desktop/flipod_jp_sync/mobile/src/word-translation.ts:26)
- `dictionaryapi.dev`
  - client-side pronunciation lookup: [mobile/src/components/WordPopup.tsx](/Users/nathanshan/Desktop/flipod_jp_sync/mobile/src/components/WordPopup.tsx:84)

## First-pass App Store Connect answers

If you want a conservative first submission, I would start with:

- `Tracking`: `No`
- `Collected data types`:
  - `Phone Number`
  - `User ID`
  - `Product Interaction`
  - `Email Address`
  - `Name`
  - `Device ID`
  - `Other User Content`

If you want a slightly leaner version, I would consider:

- Keep:
  - `Phone Number`
  - `User ID`
  - `Product Interaction`
- Review before deciding:
  - `Email Address`
  - `Name`
  - `Device ID`
  - `Other User Content`

## Recommended privacy policy sections

Your public privacy policy should at minimum cover:

1. What data you collect
2. How you use it
3. Account and authentication methods
4. Learning activity and saved content
5. Third-party service providers
6. International data transfer
7. Data retention
8. Account deletion and data deletion
9. Contact information

## Highest-value cleanup before final submission

These changes could let you simplify your disclosures later:

- Stop storing Apple `name` and `email` in `provider_display` unless you truly need them
- Move client-side Google Translate and dictionary lookups behind your own backend, or remove them
- Decide whether the app-generated `deviceId` should remain a long-lived server-linked identifier
- Ensure the final privacy policy matches the data that is actually in production

