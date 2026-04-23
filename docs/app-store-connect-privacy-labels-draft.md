# Flipod App Store Connect Privacy Labels Draft

Last updated: 2026-04-22

This document turns the current Flipod codebase into a practical App Store Connect entry guide.

Use it together with:

- [app-store-privacy-inventory.md](/Users/nathanshan/Desktop/flipod_jp_sync/docs/app-store-privacy-inventory.md:1)
- [privacy-policy-draft.md](/Users/nathanshan/Desktop/flipod_jp_sync/docs/privacy-policy-draft.md:1)

Official Apple sources used for this draft:

- [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)
- [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
- [App privacy reference](https://developer.apple.com/help/app-store-connect/reference/app-information/app-privacy)

## Recommended submission posture

For the current codebase, I recommend:

- `Tracking`: `No`
- `Privacy Policy URL`: required, publish one before submission
- `User Privacy Choices URL`: optional, can be added later
- Use the `conservative` set below unless you decide to refactor before App Review

## What to enter in App Store Connect

## 1. Privacy links

### Privacy Policy URL

Required: `Yes`

Recommended URL shape:

- `https://[your-domain]/privacy`

### User Privacy Choices URL

Optional: `Yes, if you have a page for deletion / data requests`

Recommended URL shape:

- `https://[your-domain]/privacy-choices`

You can skip this for now if you do not have a public page yet.

## 2. Tracking

Recommended answer:

- `No, we do not use data for tracking`

Why:

- I do not see ad SDKs, attribution SDKs, or cross-app advertising flows in the current mobile codebase
- The current app behavior looks like `App Functionality` and `Product Personalization`, not advertising tracking

## 3. Data types to declare now

These are the entries I would actually click in App Store Connect today.

### A. Phone Number

Choose this data type:

- `Contact Info` → `Phone Number`

Recommended answers:

- `Linked to the user`: `Yes`
- `Used for tracking`: `No`
- `Purposes`:
  - `App Functionality`

Why:

- Phone number is collected for SMS authentication and account linking

### B. User ID

Choose this data type:

- `Identifiers` → `User ID`

Recommended answers:

- `Linked to the user`: `Yes`
- `Used for tracking`: `No`
- `Purposes`:
  - `App Functionality`

Why:

- You create and store server-side account identifiers and auth sessions

### C. Product Interaction

Choose this data type:

- `Usage Data` → `Product Interaction`

Recommended answers:

- `Linked to the user`: `Yes`
- `Used for tracking`: `No`
- `Purposes`:
  - `App Functionality`
  - `Product Personalization`

Why:

- Bookmarks, likes, practice progress, and learning events influence the user experience and recommendations

## 4. Conservative additions I recommend unless you refactor first

These make the label broader, but they better match the current implementation.

### D. Email Address

Choose this data type:

- `Contact Info` → `Email Address`

Recommended answers:

- `Linked to the user`: `Yes`
- `Used for tracking`: `No`
- `Purposes`:
  - `App Functionality`

Why:

- Sign in with Apple token processing can expose email, and current code may persist it in linked identity display data

### E. Name

Choose this data type:

- `Contact Info` → `Name`

Recommended answers:

- `Linked to the user`: `Yes`
- `Used for tracking`: `No`
- `Purposes`:
  - `App Functionality`

Why:

- Current Apple sign-in flow may store a user-provided Apple display name

### F. Device ID

Choose this data type:

- `Identifiers` → `Device ID`

Recommended answers:

- `Linked to the user`: `Yes`
- `Used for tracking`: `No`
- `Purposes`:
  - `App Functionality`

Why:

- The app creates a persistent app-specific device identifier and sends it to the backend for sessions and account migration

### G. Other User Content

Choose this data type:

- `User Content` → `Other User Content`

Recommended answers:

- `Linked to the user`: `Yes`
- `Used for tracking`: `No`
- `Purposes`:
  - `App Functionality`
  - `Product Personalization`

Why:

- Saved vocab, profile preferences, and generated learning state can reasonably be treated as user-provided or user-specific content

## 5. Leaner version if you want the label smaller

If you want the smallest label that still feels defensible, I would start with only:

- `Phone Number`
- `User ID`
- `Product Interaction`

Then review these before excluding them:

- `Email Address`
- `Name`
- `Device ID`
- `Other User Content`

Important:

- I would not choose the leaner version unless you are comfortable defending why those fields should not be disclosed for the current implementation
- The riskiest omissions are `Email Address`, `Name`, and `Device ID`, because the current code path gives Apple a plausible argument that they are indeed collected

## 6. Data types I would leave unchecked for now

I would currently leave these unchecked unless the implementation changes:

- `Physical Address`
- `Other User Contact Info`
- `Health`
- `Fitness`
- `Payment Info`
- `Credit Info`
- `Other Financial Info`
- `Precise Location`
- `Coarse Location`
- `Sensitive Info`
- `Contacts`
- `Emails or Text Messages`
- `Photos or Videos`
- `Audio Data`
- `Gameplay Content`
- `Customer Support`
- `Browsing History`
- `Search History`
- `Purchase History`
- `Advertising Data`
- `Other Usage Data`
- `Crash Data`
- `Performance Data`
- `Other Diagnostic Data`
- `Environment Scanning`
- `Hands`
- `Head`
- `Other Data Types`

## 7. Recommended final choice for this release

If you want the safest first App Review path, I recommend submitting with:

- `Tracking`: `No`
- `Declared data types`:
  - `Phone Number`
  - `User ID`
  - `Product Interaction`
  - `Email Address`
  - `Name`
  - `Device ID`
  - `Other User Content`

This is not the prettiest label, but it is the least likely to create a mismatch between the code, the privacy policy, and App Store Connect answers.

## 8. How to shrink the label later

If you want a cleaner privacy label in a future release, these changes would help:

1. Stop storing Apple `name` and `email` in `provider_display`
2. Revisit whether your app-generated `deviceId` needs to remain a long-lived backend-linked identifier
3. Move client-side Google Translate and dictionary lookups behind your own service, or remove them
4. Re-check whether `Other User Content` is still needed after tightening your data model

## 9. Related non-label follow-ups

These are separate from App Store Connect labels, but still important before shipping:

1. Publish the privacy policy at a public URL
2. Consider publishing a privacy choices page for deletion and account management
3. Update [mobile/ios/Flipod/PrivacyInfo.xcprivacy](/Users/nathanshan/Desktop/flipod_jp_sync/mobile/ios/Flipod/PrivacyInfo.xcprivacy:43) so the app bundle metadata is not left empty for collected data types if your final release process requires alignment there
4. Review Sign in with Apple deletion flow and token revocation expectations

