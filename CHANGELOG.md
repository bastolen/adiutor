# Changelog

## [0.6.0](https://github.com/bastolen/adiutor/compare/v0.5.0...v0.6.0) (2026-11-27)


### Features

* attach files to requests ([#163](https://github.com/bastolen/adiutor/issues/163)) ([1621442](https://github.com/bastolen/adiutor/commit/16214423407c45c79e2e16192b8985fb909cf0a7))
* **attachments:** open a request's files in a viewer ([#182](https://github.com/bastolen/adiutor/issues/182)) ([98b9d21](https://github.com/bastolen/adiutor/commit/98b9d21d732040422c4aa8e52a97cc07faa61c32))
* **attachments:** show small previews of the files on a request ([#181](https://github.com/bastolen/adiutor/issues/181)) ([de211ca](https://github.com/bastolen/adiutor/commit/de211ca370bce04264b8471b77f22bc8ddf6db83))
* let staff Admins choose the brand colours ([#161](https://github.com/bastolen/adiutor/issues/161)) ([36a7ca2](https://github.com/bastolen/adiutor/commit/36a7ca25f775a6dc203702dcd6743c54f4164f9d))
* let staff Admins keep every page in light or dark mode ([#175](https://github.com/bastolen/adiutor/issues/175)) ([5b5c38c](https://github.com/bastolen/adiutor/commit/5b5c38c7c284c720f919516aa747ac932cd11c89))
* let staff Admins upload the logo, with a browser tab icon made from it ([#170](https://github.com/bastolen/adiutor/issues/170)) ([ef1be5b](https://github.com/bastolen/adiutor/commit/ef1be5b2d34d9293850eb602863340c79b99a6f7))
* regroup Settings into four tabs: General, Staff, Requests and Integrations ([#179](https://github.com/bastolen/adiutor/issues/179)) ([a784ceb](https://github.com/bastolen/adiutor/commit/a784ceb45e3690d5818f6eb72da1c58a28812755))
* **requests:** internal requests for the staff ([#162](https://github.com/bastolen/adiutor/issues/162)) ([8f7f829](https://github.com/bastolen/adiutor/commit/8f7f829caaedb604e96b73388934e60af4c52b52))
* **requests:** list every file on a request in a Files card ([#187](https://github.com/bastolen/adiutor/issues/187)) ([884af28](https://github.com/bastolen/adiutor/commit/884af28de2844a670866dcc9a0deb2f8eef827e5))
* **requests:** raise a request for someone at a company ([#159](https://github.com/bastolen/adiutor/issues/159)) ([96c4e61](https://github.com/bastolen/adiutor/commit/96c4e61e14baba33284c295f02a8208399eb216f))
* send news about requests to webhooks ([#160](https://github.com/bastolen/adiutor/issues/160)) ([b1a92ba](https://github.com/bastolen/adiutor/commit/b1a92bac0b6318ccc32af53cbe2e34cdb9773842))
* set up the mail server in Settings, unless the environment names one ([#165](https://github.com/bastolen/adiutor/issues/165)) ([5bb5b2b](https://github.com/bastolen/adiutor/commit/5bb5b2b34f73e1507eaa2fe1733b0c8ac464c516))
* show the staff's name instead of Adiutor, with Powered by Adiutor ([#166](https://github.com/bastolen/adiutor/issues/166)) ([ca7af55](https://github.com/bastolen/adiutor/commit/ca7af55bdabe47c97d8fe19078d4b708d3d1468b))


### Bug Fixes

* **account:** leave account names off the Picture card for staff who don't see them ([#174](https://github.com/bastolen/adiutor/issues/174)) ([0788bc8](https://github.com/bastolen/adiutor/commit/0788bc8484c995f9a0db4cd7cb7f5c843e19ef73))
* **account:** load every picture someone can choose on the account page ([#167](https://github.com/bastolen/adiutor/issues/167)) ([f1dfcfa](https://github.com/bastolen/adiutor/commit/f1dfcfa1c26671a27c38e2b8c1b8bd8fbc63cac3))
* **account:** offer the account whose picture shows when a provider's first has none ([#171](https://github.com/bastolen/adiutor/issues/171)) ([6865822](https://github.com/bastolen/adiutor/commit/6865822b6228661b2b18a87ecd679fe107d168e9))
* keep Claude Security scan reports out of the Docker image ([#164](https://github.com/bastolen/adiutor/issues/164)) ([2f37bdf](https://github.com/bastolen/adiutor/commit/2f37bdfc65a34f7b6f8cb79d9921b21dbe4cf2cc))
* paste a request's headings and code without the page's looks ([#158](https://github.com/bastolen/adiutor/issues/158)) ([7633876](https://github.com/bastolen/adiutor/commit/76338760ffb153b5472c5b159f6c84361dd5937d))
* send S3 uploads with their length, so Cloudflare R2 accepts them ([#173](https://github.com/bastolen/adiutor/issues/173)) ([def74aa](https://github.com/bastolen/adiutor/commit/def74aaaa2201af07b82aef0e2ea87e320c8d2d4))
* **settings:** keep the chosen storage on the way back from confirming it's you ([#169](https://github.com/bastolen/adiutor/issues/169)) ([e6b2591](https://github.com/bastolen/adiutor/commit/e6b25914d991110649195a924d2fab3a826dea0e))
* show the colours in use in the brand colour fields, and allow a dark accent on its own ([#168](https://github.com/bastolen/adiutor/issues/168)) ([afed8bd](https://github.com/bastolen/adiutor/commit/afed8bd749208642890b2e6d6edbe746cc458205))
* work out mention keys and picture versions from the current auth secret ([#154](https://github.com/bastolen/adiutor/issues/154)) ([7a27be7](https://github.com/bastolen/adiutor/commit/7a27be7cd01317ebbbc7c84d9ba0f7109d34fcf8))


### Performance Improvements

* **attachments:** let browsers keep files and check them with the server each time ([#176](https://github.com/bastolen/adiutor/issues/176)) ([da6f51f](https://github.com/bastolen/adiutor/commit/da6f51f07db615654d0233e0245a0cc939a5e87d))
* **storage:** keep one SFTP connection while it's used, and a minute after ([#188](https://github.com/bastolen/adiutor/issues/188)) ([f744f0c](https://github.com/bastolen/adiutor/commit/f744f0c88f807c1730545085521d41da1f1459cc))

## [0.5.0](https://github.com/bastolen/adiutor/compare/v0.4.0...v0.5.0) (2026-11-25)


### Features

* add a copy button to blocks of code in a request's text ([#74](https://github.com/bastolen/adiutor/issues/74)) ([3112df5](https://github.com/bastolen/adiutor/commit/3112df5d4a4b96504cf63a1e1e1835bc304fe962))
* add a large view to the Markdown editor ([#76](https://github.com/bastolen/adiutor/issues/76)) ([5b66276](https://github.com/bastolen/adiutor/commit/5b662766aa86c09c55401fd4cd466bf0761a6af1))
* add Markdown to requests, with an editor that formats as you type ([#57](https://github.com/bastolen/adiutor/issues/57)) ([9f6d0bb](https://github.com/bastolen/adiutor/commit/9f6d0bb5a20e1c2a2433f972af67699f40f89915))
* assign requests to staff members ([#75](https://github.com/bastolen/adiutor/issues/75)) ([fa6ff8b](https://github.com/bastolen/adiutor/commit/fa6ff8b0f650357de6dc22589922e1a3af6ea0cd))
* edit replies and request descriptions ([#81](https://github.com/bastolen/adiutor/issues/81)) ([5b8634d](https://github.com/bastolen/adiutor/commit/5b8634d3ac360cf970e5bae7735013e42c9bb67b))
* email the people on a request about what happens to it ([#90](https://github.com/bastolen/adiutor/issues/90)) ([68eda60](https://github.com/bastolen/adiutor/commit/68eda605ae881484bdae244822b87bd66c404453))
* email the staff about internal notes ([#91](https://github.com/bastolen/adiutor/issues/91)) ([28b4306](https://github.com/bastolen/adiutor/commit/28b4306802283442e8843c993990c59255b305e8))
* filter a request's activity and turn its order around ([#100](https://github.com/bastolen/adiutor/issues/100)) ([58fea39](https://github.com/bastolen/adiutor/commit/58fea3968a00bbbead23b876a486071103dea834))
* internal notes on requests ([#82](https://github.com/bastolen/adiutor/issues/82)) ([650e892](https://github.com/bastolen/adiutor/commit/650e8926cf4b520f4387fe35244b1701c56e94b8))
* jump to a lane of the board ([#109](https://github.com/bastolen/adiutor/issues/109)) ([1f290b5](https://github.com/bastolen/adiutor/commit/1f290b5d9b15da5b132af9f685a86f72fa96a99a))
* let the staff propose a solution for the company to approve ([#93](https://github.com/bastolen/adiutor/issues/93)) ([ff9a482](https://github.com/bastolen/adiutor/commit/ff9a482ba6060a25417ac58c112d014359284e7e))
* links in emails about requests sign the recipient in ([#99](https://github.com/bastolen/adiutor/issues/99)) ([8696be0](https://github.com/bastolen/adiutor/commit/8696be08ab4ad3686df7ce44ca89f8a896bcd8fc))
* mention people in a request's text ([#78](https://github.com/bastolen/adiutor/issues/78)) ([b30158f](https://github.com/bastolen/adiutor/commit/b30158fd1843ac920210e69ac72cd6a5646a57d5))
* open a request by its number with the prefix, and by a short link ([#73](https://github.com/bastolen/adiutor/issues/73)) ([da41119](https://github.com/bastolen/adiutor/commit/da411192d2c7b59dabe59a3147d8717deda3a565))
* open emails' links to a request at the news they tell of ([#95](https://github.com/bastolen/adiutor/issues/95)) ([8b8cbbe](https://github.com/bastolen/adiutor/commit/8b8cbbe2e86e0c2966aca0601bfff7c0bfb41f16))
* request types the staff manage ([#83](https://github.com/bastolen/adiutor/issues/83)) ([3da7102](https://github.com/bastolen/adiutor/commit/3da71028db5273596395f94806fc174fd203306b))
* request work while signed in as a user ([#84](https://github.com/bastolen/adiutor/issues/84)) ([6c6b9e8](https://github.com/bastolen/adiutor/commit/6c6b9e801d59264091942a1c85b3e6ae06488484))
* search long selects, and find a time zone by its city ([#103](https://github.com/bastolen/adiutor/issues/103)) ([96c2a2b](https://github.com/bastolen/adiutor/commit/96c2a2b80b0655a258d872eb733173bd174e4f7d))
* show a company's requests as a board on its page ([#111](https://github.com/bastolen/adiutor/issues/111)) ([e253c60](https://github.com/bastolen/adiutor/commit/e253c60f549660ca7526045a3b82288d2802acd9))
* show people's pictures from their GitHub or Google account ([#77](https://github.com/bastolen/adiutor/issues/77)) ([3e7241b](https://github.com/bastolen/adiutor/commit/3e7241b525020d52bd7aa45cfe33f3d0f276de5a))
* show requests as a board with a lane per status ([#104](https://github.com/bastolen/adiutor/issues/104)) ([6171701](https://github.com/bastolen/adiutor/commit/6171701efce917b13d6a0ec5fb2f476f28a7c579))
* show times in each person's own time zone ([#86](https://github.com/bastolen/adiutor/issues/86)) ([5b2978f](https://github.com/bastolen/adiutor/commit/5b2978f9fcd9db4d8e9ea2c138d80c6727d38a69))
* show what matched in a searchable select's options ([#112](https://github.com/bastolen/adiutor/issues/112)) ([a78247e](https://github.com/bastolen/adiutor/commit/a78247ec5bc1eab5d27fc65e0671fbadd389d0f3))
* sign in from an email's link in one go in Safari too ([#108](https://github.com/bastolen/adiutor/issues/108)) ([ba091fd](https://github.com/bastolen/adiutor/commit/ba091fd7f5452b44d577e9d88622292531f77424))
* split the user page and the account pages into tabs ([#105](https://github.com/bastolen/adiutor/issues/105)) ([d9bbc35](https://github.com/bastolen/adiutor/commit/d9bbc3514c71019a4fabb9a07c5eefa2223769ed))
* staff choose which languages are offered ([#85](https://github.com/bastolen/adiutor/issues/85)) ([18de436](https://github.com/bastolen/adiutor/commit/18de4363165c4b6f43ef510eca4c8d96e58d5d6b))
* subscribe people to a request, next to assigning it ([#87](https://github.com/bastolen/adiutor/issues/87)) ([274973d](https://github.com/bastolen/adiutor/commit/274973debe8431f8d687695498b3816aeec82ee9))
* turn the staff page into Settings with General, Staff and Requests tabs ([#102](https://github.com/bastolen/adiutor/issues/102)) ([a615432](https://github.com/bastolen/adiutor/commit/a615432f50b09bfe6e01af3d642227702c73d814))
* widen the lists of requests and users, and a company's pages ([#141](https://github.com/bastolen/adiutor/issues/141)) ([d3c2344](https://github.com/bastolen/adiutor/commit/d3c2344b39c54af73106237bdf2ff06c61ccd170))


### Bug Fixes

* bound what's read before checking names, links and invite lists ([#128](https://github.com/bastolen/adiutor/issues/128)) ([525ab45](https://github.com/bastolen/adiutor/commit/525ab45fac394e721aadfadeec33097451c49ecb))
* close the mobile menu when Account settings is chosen in it ([#64](https://github.com/bastolen/adiutor/issues/64)) ([503dd49](https://github.com/bastolen/adiutor/commit/503dd4903edbbd9c67d5b71e989c1d1c002e3b0d))
* continue email sign-in links only from their own page ([#129](https://github.com/bastolen/adiutor/issues/129)) ([59bbddc](https://github.com/bastolen/adiutor/commit/59bbddc40cd66897536895a42123772273d03001))
* decide reactivation, masking and request status rules in one place ([#132](https://github.com/bastolen/adiutor/issues/132)) ([6e14589](https://github.com/bastolen/adiutor/commit/6e1458946ca07929cb1c66e6daf880acc7372d26))
* **deps:** update all non-major dependencies ([#46](https://github.com/bastolen/adiutor/issues/46)) ([89350f2](https://github.com/bastolen/adiutor/commit/89350f258e0c7e86c946edde84bf3b287b184026))
* **deps:** update all non-major dependencies ([#56](https://github.com/bastolen/adiutor/issues/56)) ([baa35d5](https://github.com/bastolen/adiutor/commit/baa35d5a07b89817f95d3a6c02f64fa78e2f3abe))
* **deps:** update dependencies, TypeScript 6 and the release app token ([#134](https://github.com/bastolen/adiutor/issues/134)) ([0a20531](https://github.com/bastolen/adiutor/commit/0a2053114a765893dac833c255b85dafed39287b))
* five small bugs the public-release scan found ([#133](https://github.com/bastolen/adiutor/issues/133)) ([ef4ea57](https://github.com/bastolen/adiutor/commit/ef4ea57d16fa403c46840144b042dbf3ca17420e))
* give each page's cards their own anchors ([#117](https://github.com/bastolen/adiutor/issues/117)) ([0cbe584](https://github.com/bastolen/adiutor/commit/0cbe584fe54d89a5a49aa2b9de614fc4d6794c9c))
* give the text its focus back after a toolbar menu, and end three flaky tests ([#70](https://github.com/bastolen/adiutor/issues/70)) ([555ba4e](https://github.com/bastolen/adiutor/commit/555ba4e14ae3ed1847b26e2833a160035fdb9bb8))
* harden the Docker image and its build ([#131](https://github.com/bastolen/adiutor/issues/131)) ([a51d398](https://github.com/bastolen/adiutor/commit/a51d398e9023b12bea83316fac3c50732eedd7a6))
* judge a GitHub sign-in's MFA by the account that signed in ([#136](https://github.com/bastolen/adiutor/issues/136)) ([a051722](https://github.com/bastolen/adiutor/commit/a05172264908f1ea615b6709a22c52217227b60b))
* keep links to staff pages out of texts the company reads ([#113](https://github.com/bastolen/adiutor/issues/113)) ([8adebcc](https://github.com/bastolen/adiutor/commit/8adebcca9419cc2778dd1bd11ca47412f154a92d))
* keep mentions when a reply is copied and pasted ([#94](https://github.com/bastolen/adiutor/issues/94)) ([e937efa](https://github.com/bastolen/adiutor/commit/e937efae668c1887f16d2884a58d99362690e342))
* keep staff links out of texts too long to format ([#122](https://github.com/bastolen/adiutor/issues/122)) ([e151d1a](https://github.com/bastolen/adiutor/commit/e151d1a665420b16cc05299a0b00dcf9991b54ae))
* keep the requests table within a tablet's width ([#116](https://github.com/bastolen/adiutor/issues/116)) ([99d33ca](https://github.com/bastolen/adiutor/commit/99d33caa36c5f0a86f7b5238881f34c98a600630))
* key picture versions and keep names out of copied code ([#130](https://github.com/bastolen/adiutor/issues/130)) ([691b219](https://github.com/bastolen/adiutor/commit/691b21961b68cb45b6c40d6f206e122f386f574a))
* leave time in a tick for the alert email of a job that gives up ([#68](https://github.com/bastolen/adiutor/issues/68)) ([222df8a](https://github.com/bastolen/adiutor/commit/222df8a559a99f08cce4110bb3f3cb232b290d8f))
* let older Safari continue from a request link's page ([#119](https://github.com/bastolen/adiutor/issues/119)) ([5a95f2d](https://github.com/bastolen/adiutor/commit/5a95f2d2c74aee6e14844e96f15ab45aa6e1ba71))
* limit wrong passwords and stray input in the sign-in guards ([#135](https://github.com/bastolen/adiutor/issues/135)) ([9964027](https://github.com/bastolen/adiutor/commit/99640275daba23ad8481cfa6888a47d6c6d76914))
* make the board clearer with a screen reader ([#110](https://github.com/bastolen/adiutor/issues/110)) ([d257958](https://github.com/bastolen/adiutor/commit/d25795885af0136c4e109051bf0c071c00e50bb2))
* make the links in the audit log's who-and-where line big enough to tap ([#62](https://github.com/bastolen/adiutor/issues/62)) ([a4ba506](https://github.com/bastolen/adiutor/commit/a4ba506f5c0466d2a38b99c3162ab00f6903fc63))
* make the wait for a new emailed code per sign-in or session, like the code ([#67](https://github.com/bastolen/adiutor/issues/67)) ([a9b5cd2](https://github.com/bastolen/adiutor/commit/a9b5cd2060f24a902b11da7f11387c496788ae1b))
* mark the current page, tab and filter in forced-colours mode ([#66](https://github.com/bastolen/adiutor/issues/66)) ([98ea6d6](https://github.com/bastolen/adiutor/commit/98ea6d61b5728d3e363e07177a85a56a6eca6c64))
* name a short select's list after its label ([#124](https://github.com/bastolen/adiutor/issues/124)) ([c7c9ef2](https://github.com/bastolen/adiutor/commit/c7c9ef26200b4f8786a9542b7f17e47d8a75ac07))
* name each menu once, not after its button twice ([#121](https://github.com/bastolen/adiutor/issues/121)) ([d0f0074](https://github.com/bastolen/adiutor/commit/d0f00746b80ee1e84ca3fffb60e26b1368816635))
* reactivate an account only once when two Admins do it at the same moment ([#58](https://github.com/bastolen/adiutor/issues/58)) ([d95e1dd](https://github.com/bastolen/adiutor/commit/d95e1dd3560ba9d3af50045fede2cee8da9361e9))
* record every new account in the audit log, not only those an Admin registers ([#63](https://github.com/bastolen/adiutor/issues/63)) ([3812d7a](https://github.com/bastolen/adiutor/commit/3812d7a1574e0165795be3266d5c5c757c8c0c02))
* run the dev server's job ticks through the jobs endpoint ([#101](https://github.com/bastolen/adiutor/issues/101)) ([b2e7b4b](https://github.com/bastolen/adiutor/commit/b2e7b4b3a7602500fbe597d0e2b81c11ed38b866))
* save a new account's time zone only on the page that stays ([#107](https://github.com/bastolen/adiutor/issues/107)) ([70dc217](https://github.com/bastolen/adiutor/commit/70dc217739f898e47804555a319d47be16596b2f))
* serve an icon at /favicon.ico ([#80](https://github.com/bastolen/adiutor/issues/80)) ([72b57ba](https://github.com/bastolen/adiutor/commit/72b57ba4b26c3aa772d3621dc47f4bcd0ef88964))
* show a request down to the entry an email links to ([#106](https://github.com/bastolen/adiutor/issues/106)) ([4142000](https://github.com/bastolen/adiutor/commit/414200058f6e50ab1da79bebef8eacc210538675))
* show a saved name that shows nothing as no name in requests ([#59](https://github.com/bastolen/adiutor/issues/59)) ([9773d69](https://github.com/bastolen/adiutor/commit/9773d69212bf01347c7c5dde3b9e70b01a681171))
* tell companies with the same name apart where a company is chosen ([#61](https://github.com/bastolen/adiutor/issues/61)) ([ed1ddcc](https://github.com/bastolen/adiutor/commit/ed1ddccb81319507c3243daeb213d21870c516a9))
* warn at start-up when production has no way to send email ([#65](https://github.com/bastolen/adiutor/issues/65)) ([ad7520d](https://github.com/bastolen/adiutor/commit/ad7520d354b5b94f1a079a345619959450eecbcf))

## [0.4.0](https://github.com/bastolen/adiutor/compare/v0.3.0...v0.4.0) (2026-11-18)


### Features

* add requests that companies raise and work through with the staff ([#43](https://github.com/bastolen/adiutor/issues/43)) ([b3c03dc](https://github.com/bastolen/adiutor/commit/b3c03dc453b0192ea8ab379a6532d9035b7c3e35))


### Bug Fixes

* correct the defects found by scanning the whole application ([#47](https://github.com/bastolen/adiutor/issues/47)) ([13f37f9](https://github.com/bastolen/adiutor/commit/13f37f94563433df0c337304aae6e1472ba3037c))

## [0.3.0](https://github.com/bastolen/adiutor/compare/v0.2.0...v0.3.0) (2026-11-13)


### Features

* add background jobs that run on Vercel, with a Jobs page ([#42](https://github.com/bastolen/adiutor/issues/42)) ([d0b7258](https://github.com/bastolen/adiutor/commit/d0b7258f5d4982514871dae711f4bc81e4b5e4b8))
* let staff sign in as a user to see Adiutor as they do ([#39](https://github.com/bastolen/adiutor/issues/39)) ([18f1bac](https://github.com/bastolen/adiutor/commit/18f1bac3c8b17753d1921f3fafee269b2ec5d622))


### Bug Fixes

* **deps:** update all non-major dependencies ([#27](https://github.com/bastolen/adiutor/issues/27)) ([df1cf4f](https://github.com/bastolen/adiutor/commit/df1cf4fc7d8888938e15b503918cf0723f4cf167))
* **deps:** update next.js and react ([#28](https://github.com/bastolen/adiutor/issues/28)) ([b9d6164](https://github.com/bastolen/adiutor/commit/b9d616421d2725ae858b9ce4d51e615b129d8275))
* give every control a tap target of at least 24px ([#37](https://github.com/bastolen/adiutor/issues/37)) ([eda2b4d](https://github.com/bastolen/adiutor/commit/eda2b4da2fe3a461a6ff6bc6ae6f73ee637a548e))
* load every page and tab afresh when the browser acts as someone else ([#41](https://github.com/bastolen/adiutor/issues/41)) ([9a172b3](https://github.com/bastolen/adiutor/commit/9a172b377c763134aa297185b2e1bafe9b7299d2))
* small fixes and improvements ([#36](https://github.com/bastolen/adiutor/issues/36)) ([a3878ae](https://github.com/bastolen/adiutor/commit/a3878ae52b944841b629a00b3288e82dc1a16415))
* stop render errors when a page is left before it finishes loading ([#40](https://github.com/bastolen/adiutor/issues/40)) ([0235885](https://github.com/bastolen/adiutor/commit/0235885652d94a699fd43073acc3cfb1be28f5f0))

## [0.2.0](https://github.com/bastolen/adiutor/compare/v0.1.0...v0.2.0) (2026-11-10)


### Features

* add language support with Dutch and Spanish next to English ([#21](https://github.com/bastolen/adiutor/issues/21)) ([b4e5159](https://github.com/bastolen/adiutor/commit/b4e51598692c39722630a53b44943be0c72e24a2))


### Bug Fixes

* **deps:** update all non-major dependencies ([#19](https://github.com/bastolen/adiutor/issues/19)) ([118ea19](https://github.com/bastolen/adiutor/commit/118ea198ab423e7cc7c7ddf5d6c4072e2cb645ea))
* **deps:** update all non-major dependencies ([#3](https://github.com/bastolen/adiutor/issues/3)) ([fa2dd63](https://github.com/bastolen/adiutor/commit/fa2dd631c2d5ad5a47fb46a32a71eaaa36439d00))

## 0.1.0 (2026-11-07)


### Features

* add dark mode with theme switcher ([#5](https://github.com/bastolen/adiutor/issues/5)) ([9d93609](https://github.com/bastolen/adiutor/commit/9d936093f3986a1af43a32c54279cb48c50e7f09))
* add shared rules and helpers ([#7](https://github.com/bastolen/adiutor/issues/7)) ([0877f0e](https://github.com/bastolen/adiutor/commit/0877f0e33de2bb8a12e0027910c97fc7748bea16))
* add sign-in and account screens ([#11](https://github.com/bastolen/adiutor/issues/11)) ([8feacbf](https://github.com/bastolen/adiutor/commit/8feacbfc1d24f5a0732b4c50a076a1fce55280ab))
* add sign-in, MFA, people and audit services ([#10](https://github.com/bastolen/adiutor/issues/10)) ([405abf0](https://github.com/bastolen/adiutor/commit/405abf0deb4163fb95eb7ef25691e2d565cca44f))
* add staff and company screens ([#12](https://github.com/bastolen/adiutor/issues/12)) ([0c2cc1d](https://github.com/bastolen/adiutor/commit/0c2cc1df1da904592d69e924e0aa872765155513))
* add the database schema and local services ([#9](https://github.com/bastolen/adiutor/issues/9)) ([3c91559](https://github.com/bastolen/adiutor/commit/3c91559c565c6bf1c4abdd4d4bf0eda07db13da7))
* add the design system ([#8](https://github.com/bastolen/adiutor/issues/8)) ([4e29b8b](https://github.com/bastolen/adiutor/commit/4e29b8b8f76d4f2e455a89b79ab1d5b9c31eb440))
