# App Review response

Two versions. **Send only the one that matches what the build actually does.** Every statement in it has to be true of the uploaded build.

Attachments for App Review Information:
1. A PDF of `RIGHTS_ASSESSMENT.md`, trimmed to the sections for the features in the build.
2. A screenshot of the Google Cloud project with the YouTube Data API enabled.
3. PDFs of the Apple Search API page and YouTube's Developer Policies and Terms of Service, printed from the live URLs.
4. Any signed agreement or permission emails received.

---

## Version 1: targeted changes now (recommended unless a Deezer agreement arrives first)

> Hello, and thank you for reviewing VINALL.
>
> **Guideline 2.5.4.** VINALL plays only 30-second previews, which are not persistent audio. We have removed `audio` from UIBackgroundModes; playback now stops when the app leaves the foreground.
>
> **Guideline 5.2.1.** We have replaced every App Store screenshot. The new set uses invented records and original artwork made by us. The app icon is VINALL's own mark. [We have removed the app preview video. — only if one existed]
>
> **Guideline 5.2.3.** We reviewed every third-party service in the app and changed any use we could not document.
>
> - **Album artwork, metadata and 30-second previews** now come from Apple's iTunes Search API, under its published terms (https://performance-partners.apple.com/search-api), called from the user's device. The album page and every card of the discovery feed carry an unaltered "Listen on Apple Music" badge linking to the record; elsewhere (a user's own rated albums, profiles) each cover opens that badged album page. Previews are attributed "provided courtesy of iTunes", sit beside a link to the record, and are streamed, never downloaded or stored. No Apple content is used in our games: game screens show no artwork and play no previews.
> - **We no longer use the Deezer API in the iOS app.** ⚠️ *True only once VINALL Value has replaced the server's stream valuation, which still reads Deezer tracklists — see `../IMPLEMENTATION.md`.*
> - **Community Choice** embeds YouTube's official IFrame player, as YouTube's Terms of Service allow ("You may also show YouTube videos through the embeddable YouTube player"), under the YouTube API Services Terms accepted through our Google Cloud project (screenshot attached). It follows YouTube's Developer Policies: visible player, no background play, no rewards for viewing, our terms bind users to YouTube's Terms of Service, and our privacy policy links Google's.
> - **Game and collection values** are calculated from VINALL's own community data and public-domain (CC0) data from Wikipedia and Wikidata. We no longer use third-party streaming statistics. ⚠️ *Not yet built — do not send this line until it is.*
> - **Music Passport** uses MusicBrainz data, which is released under CC0.
> - **Game modes** that would show third-party artwork or audio as game content (Recall, Guess the Cover, Cover EXTREME) are unavailable in this version while we seek licences.
>
> A rights summary for each integration is attached.
>
> Could you also confirm whether Apple artwork may appear, with the badge, on a user's grid of their own rated albums, where each tile opens the badged album page? We want to make sure our use stays within the terms.

## Version 2: if Deezer signs an agreement before resubmission

> **Guideline 5.2.3.** VINALL's catalogue, artwork and previews are supplied by Deezer under the attached agreement with Excus Ltd dated [date], which covers [quote the granted uses: display, previews, games, territory]. Community Choice uses YouTube's official embedded player under the YouTube Terms of Service and API Services Terms (attached). Game and collection values are calculated from VINALL's own data and CC0 data.

(2.5.4 and 5.2.1 are the same as Version 1, unless the agreement also covers covers in screenshots.)

---

## Do not send

- Any claim that Deezer's public terms authorise VINALL. They don't: they grant "no right upon … the Content".
- Any claim based on "other apps do this" or on fair dealing.
- Any statement about a change that isn't in the uploaded build.
