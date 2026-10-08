# Designing a computer for a capable adult with mild vision and memory changes

This is a research guide for MomOS. It covers what published research and guidance say about building a computer interface for someone like Mom: in her 70s, sharp, self-aware, with mild age-related vision decline and a short-term memory that doesn't hold new procedures for more than a few minutes. She knows she struggles. The goal is a computer that never makes her feel that, and that looks like something an adult would choose.

Each section gives the evidence with links, then do and don't guidance, then what it means for MomOS as it stands today: what to keep, what to change and what to try with her. The screens referred to are the ones in `shell/docs/screenshots/`. The last two sections are a ranked list of changes and a plan for watching her use it.

A note on scope. Much of the best-known guidance for memory problems comes from dementia care. Mom doesn't have a dementia diagnosis, and designing for her as if she did would be its own kind of disrespect. Where this guide uses dementia research, it says so, and uses it for the fallback cases: the bad day, the moment of panic, the forgotten PIN. It doesn't use it to decide how much she's allowed to do.

## The ten principles

1. **Show, don't ask her to remember.** Every screen should carry the cues she needs to act. Recognition is easier than recall, and for her the gap is large. Nothing should depend on a step she was shown last week.
2. **Keep everything in the same place, forever.** Consistency is how a person with weak short-term memory builds a map anyway. Home, Get help and the tiles never move, never change shape and never change name.
3. **Big, dark-on-light, high-contrast text is the base, not a setting.** Aging eyes lose contrast sensitivity and need more light. Positive polarity and 7:1 contrast help at every age.
4. **One thing at a time, and only interrupt for things she'd want interrupted for.** Older adults lose more working memory when interrupted and recover more slowly. Every card that pops up costs her the thread of what she was doing.
5. **Name things for what they do, in plain adult words.** No jargon, no brand names she didn't already know, and no baby talk. Patronizing language makes older adults understand less, not more.
6. **Make it beautiful and ordinary.** Stigma is a design problem. A computer that looks like an aid tells her every morning that she needs one. A computer that looks like a well-made thing tells her she chose it.
7. **Nothing she does can break it, and the screen should say so.** Fear of breaking things is one of the biggest barriers for older users. Prefer undo and safe defaults over warnings, and say "it isn't your fault" when something fails.
8. **Help is one press away, it's a person, and she's told what happens next.** The helper sees what she saw, so she never has to describe the problem. She always knows when someone is looking.
9. **Few choices, chosen together.** Older adults prefer fewer options. Personalization is valuable when it's a short list set up once, with her, and hard to change by accident.
10. **Watch her use it, don't test her.** Stereotype threat measurably lowers older adults' performance. How you observe changes what you see.

## Vision

### What the research says

Normal aging changes the eye in ways that matter for screens. The lens scatters more light and lets less through, so less light reaches the retina, contrast sensitivity drops and glare becomes a bigger problem. Cynthia Owsley's 2011 review in *Vision Research* covers these optical and neural changes, and later reviews treat the optics of the aging eye as the main cause of contrast loss in normal light ([summary review](https://pmc.ncbi.nlm.nih.gov/articles/PMC3864381/)). The lens also yellows, filtering short wavelengths below about 460 nm, which makes blue-versus-yellow and blue-versus-green distinctions harder and makes screen white look less white ([Frontiers in Integrative Neuroscience 2023](https://www.frontiersin.org/journals/integrative-neuroscience/articles/10.3389/fnint.2023.1129315/full); [IOVS on lens transmission](https://iovs.arvojournals.org/article.aspx?articleid=2129060)).

On dark mode, the evidence is clearer than the folklore. Piepenbrock and colleagues expected older adults might do better with light text on dark, because of lens scatter. They found the opposite: dark text on a light background was better for both younger and older adults on acuity and proofreading, and they recommend it for all ages ([Piepenbrock et al., *Ergonomics* 2013](https://pubmed.ncbi.nlm.nih.gov/23654206/)). A follow-up found the advantage is largest for small text ([Piepenbrock et al., *Human Factors* 2014](https://journals.sagepub.com/doi/abs/10.1177/0018720813515509)). The reason is retinal illuminance: a brighter screen makes up for the light the aging eye loses.

On size, Bernard, Liao and Mills tested older readers on 12-point and 14-point serif and sans serif fonts. The 14-point fonts were more legible and read more efficiently, and 12-point serif text was read slowest ([CHI 2001 extended abstracts](https://dl.acm.org/doi/10.1145/634067.634173)). The National Institute on Aging's older checklist asked for 12 to 14 point minimum and a sans serif face that isn't condensed ([NIA/NLM, "Making your website senior friendly"](https://sites.wip.nlm.nih.gov/pubs/techbull/ma12/ma12_seniorhealth.html)). Nielsen Norman Group's studies of 123 users over 65, across three rounds from 2001 to 2019, found small and lightly colored text was still the most common problem ([Kane, NN/g 2019](https://www.nngroup.com/articles/usability-for-senior-citizens/)).

WCAG sets the baseline: 4.5:1 contrast for body text at level AA and 7:1 at AAA ([WAI, "Developing websites for older people"](https://www.w3.org/WAI/older-users/developing/)), text that can scale to 200% without breaking, and line height of at least 1.5 when users set it ([WCAG 1.4.12](https://dequeuniversity.com/resources/wcag2.1/1.4.12-text-spacing)). W3C's older users work found WCAG covers nearly all of what older web users need ([WAI older users](https://www.w3.org/WAI/older-users)).

### Do and don't

- Do use dark text on a light, warm background as the default. Keep dark themes for people who ask for them or for night use, and dim the screen before inverting it.
- Do hold anything she has to read to 7:1 contrast, not only the main text. Secondary grey is where older eyes fail first.
- Do use a clear sans serif for anything she acts on, with a large x-height and open shapes. Serifs are fine for large display text like a greeting.
- Do make text-size steps big enough to notice. A 10% change reads as no change.
- Don't rely on blue against green, or on hue alone, to tell states apart. Pair color with a word or a shape.
- Don't use thin weights, light grey placeholder text or text over photos.

### For MomOS

**Keep.** The Morning theme is exactly what the evidence supports: warm light paper, near-black ink, a 7:1 check in `shell/dev/contrast.js`. Source Sans 3 for actions and Newsreader for the greeting is a good split. Status in words, like "Internet: working" and "Battery: 64%", avoids tiny icons.

**Change.** The smallest text on the screen is the text she most needs when something is wrong. The bar's internet and battery lines are 22 px in the soft ink color. On this 11.6-inch, 135 ppi screen, 22 px is about 4.1 mm, which is smaller at laptop distance than the 14-point text that beat 12-point in Bernard's study. The Family page hint, "Tap a face to send a message or call.", and the lock hint in More are also in the soft color. Raise the floor to about 26 px for anything she reads, and hold hints and status to 7:1, not 4.5:1.

The "Larger" text size multiplies page text by 1.12 and leaves the bar alone. That's too small a step to notice, so she may press it, see nothing happen, and decide she did something wrong. A step of 1.25 to 1.3, applied to the bar's status text too, would be visible.

The low-battery warning is the battery line turning red and bold at 15%. That relies on color and on 22 px text. See the attention section for a better version.

**Try with her.** Sit her at her usual chair and distance, in her usual light, and ask her to read the bar status aloud, then the Family hint. Try Morning and Evening at night. The research predicts Morning reads better even in the evening, but glare from a bright white screen in a dark room is real. If she squints at Morning after dark, lower the brightness first. Evening is also fine to keep if she simply likes it.

## Memory and learnability

### What the research says

Recognition beats recall because it gives memory more cues to work with ([NN/g, "Memory recognition and recall"](https://www.nngroup.com/articles/recognition-and-recall/)). The W3C cognitive accessibility guidance makes this an objective of its own, "Ensure processes do not rely on memory", alongside "Help users understand what things are and how to use them", and asks for familiar icons and terms, controls that stay in the same place, and critical features that don't change ([W3C COGA, "Making content usable"](https://www.w3.org/TR/coga-usable/); [working draft](https://w3c.github.io/coga/content-usable/)).

Apple's Assistive Access, built with people with cognitive disabilities and their supporters, rests on three rules: reduce options so people can complete a task without distractions, help people recognize and recover from errors, and create familiar, consistent interactions for "a sense of predictability and comfort." It pairs text with images everywhere and puts one predictable back button in the same spot on every screen ([Apple newsroom 2023](https://www.apple.com/newsroom/2023/05/apple-previews-live-speech-personal-voice-and-more-new-accessibility-features/); [WWDC23 "Meet Assistive Access" notes](https://wwdcnotes.com/documentation/wwdc23-10032-meet-assistive-access/)). It also merges Phone and FaceTime into one "Calls" app, so the person thinks about who and what, not which app.

For people with memory impairment, cognitive rehabilitation research has two well-supported methods. Errorless learning keeps mistakes out of the learning phase, so the wrong move doesn't get learned alongside the right one. Spaced retrieval practices the right move at growing intervals ([Clare and Jones 2008, *Neuropsychology Review*](https://link.springer.com/article/10.1007/s11065-008-9051-4); [Jefferson methodology paper](https://rehabilitationresearch.jefferson.edu/content/dam/academic/research/rehabilitation-research-institute/ncrrn/methodology-papers/errorless_learning_spaced_retrieval.pdf)). Most of that work is in dementia, so treat it as a hint, not a prescription. The useful idea for her is that procedural habits, the "my hands know it" kind, hold up better than facts or instructions. A move repeated the same way every day can stick where a verbal explanation won't.

Research on people with mild cognitive impairment finds their perceived and observed ability to use everyday technology is lower than that of cognitively healthy peers, and that over several years the technology they use and the activities they keep up change together ([Malinowsky et al. 2010](https://pubmed.ncbi.nlm.nih.gov/20545577/); [Hedman et al. 2016](https://journals.sagepub.com/doi/abs/10.1177/0308022615586800)). That's a reason to protect what she already knows, like the touchpad gestures from years of macOS on this same laptop.

### Do and don't

- Do put every cue on the screen: a label on every icon, a visible Home, a visible way back.
- Do keep positions, shapes, names and colors fixed. A change to the layout is a new computer to someone who can't hold the old one in mind.
- Do make the system remember for her. Show what's already done, what's next and what just happened.
- Do reuse what she already knows: her iPhone's words, her Mac's touchpad habits, her PIN.
- Don't teach procedures that only work if she remembers them. If a task needs a paragraph of explanation, redesign the task.
- Don't hide things behind hover, long-press, right-click, gestures or double-click.
- Don't rely on "she'll get used to it." Habituation needs stability, and stability is the design.

### For MomOS

**Keep.** Almost all of the existing rules are this principle already: one full-screen thing at a time, a bar that never moves, Home that never closes anything, tiles that bring back the open copy, no files or save dialogs, no keyboard shortcuts. "Photos is a place. Email is a place." is a direct application of recognition over recall. The greeting with the day and date in words is good orientation.

**Change.** The greeting says "Good morning, Mom" at 12:33 AM, because `greeting()` in `shell/Common/validate.js` returns morning for any hour before noon. For someone who uses the date line to orient herself, "morning" at half past midnight is wrong in the way that matters, and "12:33 AM" is the time format people most often misread. Show "Good evening" until about 4 AM, or add the part of day to the date: "Saturday night, September 26".

Reminders vanish from memory once she presses OK. "Did I already take my pills?" is the classic question for someone with her memory. The Today line shows what's coming, but not what's done. After OK, keep the item in the Today line with a check and the time: "Took evening pills, 8:05 PM". The timeline already records when she pressed OK, so the data exists.

A message card from Grace offers Open and Close. If she closes it, nothing on the home screen shows that Grace wrote. She has to remember it, then remember that it's in Telegram. Put a quiet marker on Grace's face on the Family page, like "Wrote to you at 4:10", until she opens the chat.

**Try with her.** The Family page opens a Telegram chat, and Telegram is a full app with menus, stickers, settings and a call button that looks like the others. That's where MomOS stops controlling the screen, so it's the most likely place she'll get lost. Watch the first few times she messages or calls someone and note where she hesitates. If she hesitates at the same spot twice, that's a candidate for a MomOS card that sits between the face and Telegram, with two big buttons: "Write to Grace" and "Video call Grace".

## Attention and interruptions

### What the research says

Clapp and Gazzaley found that interruptions hurt working memory more in older adults than in younger ones, and traced it to trouble switching back to the original task after the interruption ([PNAS 2011](https://www.pnas.org/doi/full/10.1073/pnas.1015297108)). For someone whose short-term memory is already the weak point, every pop-up risks the thread of what she was doing.

COGA's "Help users focus" objective asks designers to cut distractions and moving elements and to help people reorient after a break ([W3C COGA](https://www.w3.org/TR/coga-usable/)). WCAG requires a way to pause or hide moving content ([2.2.2](https://www.w3.org/WAI/older-users/developing/)) and, at AAA, a way to turn off animation triggered by interaction ([2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)). NN/g lists "startling sounds" among the features that make the web unfriendly to older users ([Kane 2019](https://www.nngroup.com/articles/usability-for-senior-citizens/)).

Confirmation dialogs and warnings stop working when they appear often. People tune them out after a couple of exposures ([NN/g on confirmation dialogs](https://www.nngroup.com/articles/confirmation-dialog/)). An interruption she sees every day becomes an interruption she dismisses without reading.

### Do and don't

- Do sort every interruption by who it's for. Some need her now, like a due reminder or the internet being down when she presses help. Some are worth knowing, like a message from family. Some are not her business at all: updates, sync, errors she can't fix.
- Do show "needs her now" in the middle, large, with one clear action. Show "worth knowing" at the edge, and let it wait. Never show "not her business."
- Do say how long something will stay and whether it will come back.
- Do make any card say what it's about in its first three words.
- Don't stack cards. One at a time, oldest first.
- Don't use motion to get attention. A fade is enough.
- Don't play sounds she didn't ask for, except for a due reminder if she wants that.

### For MomOS

**Keep.** The existing policy is right: no update prompts, no "allow notifications?", websites can't send notifications at all. Short fades instead of bounces. Due reminders stay until she presses OK, one at a time. Hyprland animations are off.

**Change.** Low battery is currently only the bar text turning red. For her it's a "needs her now" event that will end in a dead laptop and a feeling that she broke it. At 15%, show one card: "The battery is getting low. Plug in the charger." At 5%: "The laptop will turn off soon. Plug in the charger now." Show the charger's shape if you can photograph hers.

The reminder card sits over the Today line and the tiles, and the Today line behind it lists the same reminder again. That's fine for now, but watch for whether she reads the card or the line.

**Try with her.** Find out which interruptions she wants. Some people like a chime for a reminder and some find it alarming. Ask her once, set it, and don't ask again.

## Pointer, touchpad and targets

### What the research says

Older adults point more slowly, and the input device matters. Hertzum and Hornbæk compared three age groups with mouse and touchpad. Everyone was slower and less accurate with the touchpad, and the touchpad slowed the oldest group, aged 61 to 69, the most ([*IJHCI* 2010](https://mortenhertzum.dk/publ/IJHCI2010b.pdf)). Findlater and colleagues found touchscreens cut older adults' movement time by 35% compared with a mouse, against 16% for younger adults, which says direct pointing helps them most ([CHI 2013](https://dl.acm.org/doi/10.1145/2470654.2470703)). Double-clicking causes both movement errors and timing errors in older users, and researchers suggest removing the need for it ([Hollinworth, University of Reading](https://centaur.reading.ac.uk/1118/1/sse_nic_hollinworth.doc)).

For targets, WCAG 2.2 sets 24 by 24 CSS pixels as the AA minimum and 44 by 44 at AAA. The AAA criterion names hand tremor and fine motor difficulty as reasons ([W3C, Target size enhanced](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)). For touchscreens, Jin, Plocher and Kiff recommended buttons of at least 11.43 mm for older users and a gap of 3.17 to 12.7 mm between them to cut errors ([UAHCI 2007](https://link.springer.com/chapter/10.1007/978-3-540-73279-2_104), as summarized by [W3C's mobile accessibility task force](https://www.w3.org/WAI/GL/mobile-a11y-tf/wiki/Summary_of_Research_on_Touch/Pointer_Target_Size)). Spacing matters as much as size, because a near miss on a target lands on its neighbor.

### Do and don't

- Do make every action a single click on a large target. MomOS targets can be far above WCAG's 44 px, and should be.
- Do leave space between targets that do different things, especially between a safe choice and a consequential one ([NN/g on consequential options](https://www.nngroup.com/articles/proximity-consequential-options/)).
- Do keep the pointer large and high-contrast.
- Do keep the gestures she already had on this Mac.
- Don't depend on hover. Hover states are fine as extra feedback, but nothing should appear only on hover.
- Don't use drag, double-click or right-click for anything she needs.

### For MomOS

**Keep.** The tiles are around 75 by 28 mm, and bar buttons are about 12 mm tall with generous gaps. Everything is one click. The cursor is enlarged. Natural scrolling and tap-to-click match what macOS had on this laptop, so her hands already know them.

**Change.** Nothing in the shell. The pointer problems will be in the web apps. YouTube's player controls appear only on hover, Gmail has small icon buttons, and Facebook has dense menus. Chromium zoom at 110 to 125% helps. Check that the zoom sticks per site.

The page text says "Tap a face" and "Tap the one you like" on a laptop without a touchscreen. If she has tap-to-click, "tap" may match what her finger does. If she presses the touchpad down, it won't. Pick the verb she uses herself and use it everywhere. The shell docs say "press" for Get help, so "press" might be the safe choice.

**Try with her.** Give her a plain wired or wireless mouse for a few days and see if she reaches for it. The research predicts it will be faster and more accurate than the touchpad. If she prefers the touchpad because it's what she knows, that's a fine answer too. Also watch for accidental clicks from a resting palm with tap-to-click on.

## Language and tone

### What the research says

"Elderspeak" is the name for talking to older adults with simplified words, exaggerated tone, pet names and "we" for "you." Kemper and Harden found older adults rated instructions in elderspeak as patronizing and harder to follow, and they did no better on the task than with normal adult speech ([Williams, Kemper and Hummert 2004](https://pubmed.ncbi.nlm.nih.gov/15960030/); [*Innovation in Aging* concept analysis](https://academic.oup.com/innovateage/article/5/3/igab023/6314228)). In dementia care, elderspeak roughly doubled the chance of resistance to care ([Williams et al. 2009](https://pmc.ncbi.nlm.nih.gov/articles/mid/NIHMS172973/)). Plain is not the same as childish.

COGA asks for clear content, familiar words and the same term for the same thing everywhere ([W3C COGA](https://www.w3.org/TR/coga-usable/)). A scoping review of design research found that 72% of studies about technology for older people used ageist language, most often framing older users only by decline ([Mannheim et al. 2022, *The Gerontologist*](https://pmc.ncbi.nlm.nih.gov/articles/PMC10448991/)). That framing leaks into products.

### Do and don't

- Do write like a thoughtful adult talking to another adult. Short sentences, common words, full grammar.
- Do use her name where a person would, like the greeting, and nowhere else.
- Do say who did something: "Sam took a picture of your screen." "Grace wrote to you."
- Do say what will happen before it happens: "You'll need your PIN to unlock it."
- Do take blame off her when something fails: "It isn't your fault."
- Don't use exclamation marks, "Oops!", "Great job!" or "Don't worry!" Praise for pressing a button is condescending.
- Don't use technical words: Wi-Fi, app, download, update, error, session, sync, account.
- Don't use brand names she doesn't already know.

### For MomOS

**Keep.** The voice is already good. "The internet isn't working. It isn't your fault." "Call Sam at 555-555-0100." "Type your PIN to unlock." "You'll need your PIN to unlock it." "Sam is looking at your screen." These are specific, adult and calm.

**Change.** The "Telegram" tile breaks the project's own rule about naming buttons for what she wants to do. Facebook and YouTube are names she likely knew before, and COGA's advice about familiar terms favors keeping them. Telegram was chosen for MomOS, so it's a new word with no meaning to her, and it duplicates Family. Rename it "Messages" if she needs a place to see all her chats, or remove it and let Family be the only way in.

"Close" on the message card can read as "delete this message." "Later" says what it does.

"OK" on a due reminder works, but for a task, "Done" records what she did and matches the Today line check suggested above.

**Try with her.** Read the screens with her and ask what she thinks each button will do before she presses it. Her words are the best source of labels. If she calls the Family page "the faces," that's worth knowing.

## Dignity and aesthetics

### What the research says

Assistive products are abandoned at high rates, and appearance is part of why. Bichard, Coleman and Langdon describe "aesthetic stigma": products that signal disability get rejected even when they work ([UAHCI 2007](https://researchonline.rca.ac.uk/362/1/Bichard_:_Langdon_HCII_07.pdf)). Graham Pullin's *Design Meets Disability* uses eyeglasses as the model: they moved from medical appliance to fashion because designers treated them as something people choose to wear ([MIT Press](https://mitpress.mit.edu/9780262516747/design-meets-disability/)).

Li, Lee and Xu tested health wearables with older adults and found four design factors that made people feel stigmatized: poor aesthetics, obvious social signals like a big red emergency button, awkward use, and data sharing with family that felt like surveillance. One participant said a device "makes me feel so old that I need taking care of" ([*International Journal of Design* 2020](http://ijdesign.org/index.php/IJDesign/article/view/3126/896)). Renaud and van Biljon wrote that "senior" phones are "at best, inadequate and, at worst, insulting" and are built on a picture of the incapable elder ([*UAIS* 2010](https://link.springer.com/article/10.1007/s10209-009-0177-9)). Research on senior phones notes that the label "senior" itself draws resistance ([Easierphone, 2023](https://www.scitepress.org/Papers/2023/119744/119744.pdf)).

Self-determination theory gives a useful test for whether a design respects someone. Motivation and wellbeing depend on autonomy, competence and relatedness, and Peters, Calvo and Ryan show how to design for each ([*Frontiers in Psychology* 2018](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2018.00797/full)). For her that means: she chooses, she succeeds and it connects her to people.

Commercial senior products show what to avoid. Samsung's Easy Mode, which people search for as "old people mode," mostly enlarges icons and text on the same crowded phone ([example guide](https://eldrio.com/how-to-turn-on-old-people-mode-on-samsung)). Jitterbug and GrandPad, sold as senior devices, are reviewed mainly by their size and simplicity, and their marketing and look are built around age ([TechRadar GrandPad review](https://www.techradar.com/reviews/grandpad)). Apple's Assistive Access is a better model because it's a mode of the ordinary iPhone, with the same materials and type, not a separate device for old people.

### Do and don't

- Do use the visual language of good consumer products: real typefaces, soft color, restrained motion, generous space.
- Do make size and contrast feel like the design, not a setting laid on top of it.
- Do give her things to be proud of. A good-looking screen is one she'll show a friend.
- Don't use the words senior, elderly, easy mode, simple mode or assist anywhere she can see.
- Don't use cartoon icons, primary colors, oversized rounded buttons with thick outlines or stock photos of older people.
- Don't make the help button an alarm. It's a way to reach her son, not an emergency.

### For MomOS

**Keep.** This is the project's strongest area. The shell README says it directly: "a screen that looks like an accessibility aid would remind her of that every time she sat down." The paper grain, the serif greeting, the soft cards and one-color line icons read as a considered product. The theme names, Morning, Linen, Rose, Evening, Garden and Slate, sound like choices, not accommodations.

The Get help button is a warm terracotta, not an alarm red, and it says "from Sam," which makes it a person rather than a panic button. That fits the finding about red emergency buttons exactly. Keep it that way.

**Change.** The Family page with one face on a gradient placeholder looks unfinished, and an unfinished page looks like a toy. Real photos of family members should go in before handover, and the page should be laid out for the number of faces she actually has.

**Try with her.** Ask her what she thinks of how it looks, as you'd ask about a new coat. Watch for whether she shows it to anyone. Showing it off is the best sign that it doesn't feel like an aid.

## Error recovery and fear of breaking things

### What the research says

Fear of doing damage is a big barrier. In Vaportzis, Giatsi Clausen and Gow's focus groups with new tablet users aged 65 to 76, one participant said: "I'm just frightened in case I go in somewhere and then I can't get out." Another: "I feel a bit inadequate sometimes" ([*Frontiers in Psychology* 2017](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2017.01687/full)). The CREATE study of 1,204 adults found computer anxiety and low computer self-efficacy predicted lower technology use, and they partly explained the age gap ([Czaja et al. 2006, *Psychology and Aging*](https://www.researchgate.net/publication/7014155_Factors_Predicting_the_Use_of_Technology_Findings_From_the_Center_for_Research_and_Education_on_Aging_and_Technology_Enhancement_CREATE)). Confidence and anxiety improve with training and use. Wild and colleagues found both got better over a year of computer use, though cognitively intact participants gained more than those with mild cognitive impairment ([Wild et al. 2012, *Alzheimer's & Dementia*](https://pubmed.ncbi.nlm.nih.gov/23102124/)). Confidence is built by succeeding, so a design that lets her succeed every day is also a training program.

NN/g found older users make more mistakes than younger users and are hurt most by unforgiving designs that reject input or bury the error message ([Kane 2019](https://www.nngroup.com/articles/usability-for-senior-citizens/)). Apple's Assistive Access says that for significant actions people "should be given clear instructions and given the opportunity to understand what is happening before continuing" ([WWDC23 notes](https://wwdcnotes.com/documentation/wwdc23-10032-meet-assistive-access/)). NN/g's broader advice is to prefer undo over confirmation, because confirmation dialogs get clicked through ([NN/g](https://www.nngroup.com/articles/confirmation-dialog/)).

### Do and don't

- Do make every place reachable from Home, and make Home safe from every place.
- Do make actions reversible, and put the undo on the same screen as the action.
- Do explain failures in terms of what happens next, not what went wrong: "The internet isn't working. Call Sam at…"
- Do tell her it's not her fault when it isn't, which is almost always.
- Don't ask "Are you sure?" for ordinary actions. Save confirmation for the truly irreversible, and there should be almost none of those.
- Don't show error codes, stack traces, crash dialogs or anything from the system underneath.

### For MomOS

**Keep.** The architecture is built for this. Home never closes anything. Tiles bring back the open window. There are no files to lose. Every part degrades on its own, and if the shell crashes, Chromium opens full screen instead of a blank desktop. The offline card's "It isn't your fault" is the most important sentence in the product.

**Change.** Colors and text size can be changed by her at any time, and there are six themes, two icon styles and two text sizes. A stray press there changes the whole look of the computer, and for someone who can't hold the old look in mind, it may feel like it's a different computer or that she broke it. Add a "Put it back how it was" button on that page, shown only after a change, or have momd notice a theme change and include it in the weekly report so the helper can ask about it.

The lock screen has no way out if she forgets her PIN. She's used it for years, so it's unlikely, but a bad day is exactly when it would happen. Add a line under the keypad: "Forgot your PIN? Press here and Sam will be told." That sends a help request and shows the phone number, and the helper can unlock remotely. Wrong attempts should say "That isn't the PIN. Try again." with no counter and no lockout message.

**Try with her.** Ask her to find something, then say "and now get back to where you started." Watch whether she reaches for Home without thinking. That's the habit everything else rests on.

## Help and trust, including remote help

### What the research says

Families are the main source of tech help for older adults. Maria Bakardjieva called these helpers "warm experts" ([Hänninen and Taipale 2021](https://journals.sagepub.com/doi/full/10.1177/1461444820917353)). Kiesler and colleagues found that 89% of families in a home internet trial needed outside help in the first year, and that help flowed to and through the most technical family member ([*Human-Computer Interaction* 2000](https://www.cs.cmu.edu/~kiesler/publications/2000pdfs/2000_troubles-with-internet-help-home.pdf)). Warm experts also "over-help": they fix the problem instead of letting the person do it, and the person learns nothing and feels less capable ([a 2024 Finnish study of warm experts](https://www.tandfonline.com/doi/full/10.1080/02601370.2024.2353176)). In Vaportzis's groups: "My son is just too fast. He says it's common sense, use your brain, you should know this. They just have no patience."

On monitoring, Berridge and Wetle interviewed older women and their adult children about in-home monitoring. The children put more weight on safety, the parents on autonomy, privacy and identity, and cameras drew the sharpest disagreement ([*The Gerontologist* 2020](https://pubmed.ncbi.nlm.nih.gov/31102442/)). Li, Lee and Xu's participants described family data sharing as "like a surveillance device" ([2020](http://ijdesign.org/index.php/IJDesign/article/view/3126/896)). Remote screen access is a mild form of the same thing, and it's only fair if she always knows.

On trust, the numbers are stark. People over 60 filed 147,127 complaints to the FBI's IC3 in 2024 and reported $4.8 billion in losses, more than any other age group ([IC3 2024 annual report](https://www.ic3.gov/AnnualReport/Reports/2024_IC3Report.pdf)). Tech support fraud cost $1.46 billion across all ages that year. The FTC found adults over 60 were about five times more likely than younger adults to report losing money to a tech support scam, and the usual scam is a pop-up or call that ends with the victim giving a stranger remote access ([FTC data spotlight 2019](https://www.ftc.gov/news-events/data-visualizations/data-spotlight/2019/03/older-adults-hardest-hit-tech-support-scams)). A remote-help system for an older person has to look nothing like that scam, and she has to be able to tell the difference.

### Do and don't

- Do make the help channel one button, always visible, that reaches a named person.
- Do tell her what happens after she presses it, and how long it usually takes.
- Do tell her whenever someone is looking, and tell her when they've stopped.
- Do make the legitimate help look and sound different from every scam: it comes from a button she pressed, from a person she knows, on her own screen.
- Do teach one rule and repeat it until it's habit: "Sam will never ask you to call a number on the screen." It's short and survives weak memory better than a list of scam signs.
- Don't fix things silently while she's using the computer. Tell her what you did, in one sentence, after.
- Don't help by taking over when she's willing to do it herself. Talk her through it, even when it's slower.

### For MomOS

**Keep.** One Get help button, always in the same place, named for a person. She doesn't describe the problem, because the helper gets her screen and the minutes before. Offline, it shows the phone number large. The viewer banner is always shown while someone is connected and can't be dismissed. The laptop never runs commands from the backend. Screenshots are silent, at her request, and only live viewing is announced. Screenshots only leave in a help request she started. uBlock Origin Lite is forced on, and sites can't send notifications. These choices match the evidence closely.

**Change.** After she presses Get help, the bar says "Sam has been told" and a banner says "Sam has been told. Help is on the way." That confirms the press. It doesn't say what happens next, so she may wait by the laptop or press again after forgetting. Try: "Sam has been told. He'll call you or look at your screen soon. You can keep using the computer." If the helper hasn't connected after 15 minutes, change it to something honest: "Sam hasn't seen it yet. If it's urgent, call him at…"

The viewer banner appears and disappears. With her memory, the absence of a banner is easy to miss, so she may not know whether he's still there. When the session ends, show a short card: "Sam has stopped looking at your screen." Consider adding a line that answers the question people ask about screen sharing, whether he can see her: "He can see your screen, not you." Check that this stays true during Telegram video calls, where the camera is on for a different reason.

The viewer banner text is smaller than the other banners, at `Theme.label - 4`. Since it's the one she must never miss, make it the same size as the rest.

The helper should also avoid over-helping. When she asks for help with something she can do, like finding an email, talk her through it on the phone while he watches, and let her hands do it. That's how the habit forms.

**Try with her.** Explain the viewer banner once, and then, days later, ask her what the purple bar means when it appears. If she can't say, the wording needs work. Separately, ask her, calmly and without a quiz, what she'd do if a website said her computer had a virus and to call a number. Her answer tells you whether the one rule needs repeating.

## Personalization without choice overload

### What the research says

Reed, Mikels and Simon found older adults wanted fewer options than younger adults across every decision domain they tested ([*Psychology and Aging* 2008](https://pubmed.ncbi.nlm.nih.gov/18808256/)). A follow-up found older adults would pay less for extra options than younger adults would ([Mikels, Reed and Simon 2009](https://pmc.ncbi.nlm.nih.gov/articles/PMC2905131/)). COGA still counts personalization as an objective, because a familiar symbol, a preferred color or a larger text size can make the difference ([W3C COGA](https://www.w3.org/TR/coga-usable/)). Apple's model is that a trusted supporter sets up Assistive Access with the person, and the person uses it without seeing the settings ([Apple newsroom 2023](https://www.apple.com/newsroom/2023/05/apple-previews-live-speech-personal-voice-and-more-new-accessibility-features/)).

The tension is real. Autonomy says she should choose. Choice overload and memory say she shouldn't face the choice every day. The way through is to make choices once, together, with few options, and then keep them stable.

### Do and don't

- Do set up the look with her, in one sitting, as a choice between two or three.
- Do let her change the things she actually cares about, like text size, from somewhere she can find.
- Do keep the options she can reach small and hard to trigger by accident.
- Don't show 24 combinations of look to someone who may not remember which one she picked.
- Don't take away a choice she values just because it adds complexity. Ask her.

### For MomOS

**Keep.** Personalization lives behind More, not on the home screen. The theme previews show what each will look like, which is recognition over recall. The helper controls tiles and family from the admin app, so she never manages them.

**Change.** Once you and she pick a look together, cut what More shows her. Options include showing only her theme and one alternative, like Morning and Evening, plus text size. Or keep the whole page but add the "Put it back" button from the error section. The Colorful icon style is a good option to keep available. Some people find YouTube's red and Gmail's M faster to spot than a label, and it's worth trying with her.

**Try with her.** Show her Simple and Colorful icons on the same day, a week apart, and see which one she finds tiles faster with. Don't ask which is "easier." Ask which she likes, and time the finding without her noticing.

## Testing with the person

### What the research says

Most HCI research uses young, educated participants. Dickinson, Arnott and Prior describe how research with older adults has to change: longer sessions with breaks, familiar settings, a relationship before the session, and care with think-aloud, which adds load ([*Behaviour & Information Technology* 2007](https://www.tandfonline.com/doi/abs/10.1080/01449290601176948)). NN/g's guidance on testing with older users makes similar points ([NN/g video](https://www.nngroup.com/videos/user-testing-older-adults/)). Dementia co-creation guidance from the Alzheimer's Society asks designers to respect people's skills and knowledge equally and to adapt to how they prefer to communicate ([Alzheimer's Society co-creation guide](https://www.alzheimers.org.uk/sites/default/files/2022-05/alzheimers-society-co-creation-guide.pdf)).

The most important finding for her is about stereotype threat. When older adults are reminded, even subtly, of stereotypes about aging and memory, their performance drops. Lamont, Swift and Abrams's meta-analysis found a reliable effect, and it was larger for subtle cues than for blatant ones ([*Psychology and Aging* 2015](https://pubmed.ncbi.nlm.nih.gov/25621742/)). A session framed as "let's see how you do with the new computer" is a subtle cue. So is a son with a notebook.

### Do and don't

- Do observe during normal use, at home, at her usual times.
- Do frame any session as her helping you: "I want to know what's annoying so I can fix it."
- Do log quietly and look later. MomOS already records when she opens tiles, presses help and answers reminders.
- Do blame the design out loud whenever something goes wrong: "That button's in a silly place."
- Don't give tasks with right answers or time her while she knows it.
- Don't correct her in the moment unless she asks, or unless she's stuck.
- Don't ask her to remember what went wrong yesterday. Use the screenshots and timeline.

### For MomOS

**Keep.** The weekly report, the timeline and the pre-help screenshots are observation tools that don't put her on the spot. "Start small" and "add buttons only after seeing where she hesitates" from `docs/why.md` is exactly the right method.

**Change.** Add a few counts to the weekly report that answer design questions: how often she presses Home from each app, how often a tile is pressed within a few seconds of another, which suggests a wrong guess, how often More is opened and closed without a choice, and how long reminders wait before OK. These say where she hesitates without anyone asking her.

## Recommended changes

Ranked by value to her within each size. Small means an afternoon or less, medium a day or two, large more than that or a design question that needs her input first.

### Small

1. **Fix the midnight greeting and clarify the time of day.** "Good evening" until about 4 AM, or "Saturday night" in the date line. In `greeting()` in `shell/Common/validate.js`.
2. **Say what happens after Get help.** "He'll call you or look at your screen soon. You can keep using the computer." Change it if the helper hasn't connected in 15 minutes.
3. **Tell her when the helper stops looking.** A short "Sam has stopped looking at your screen" card, and the viewer banner at full banner size.
4. **Raise the text floor and the contrast of secondary text.** Bar status and page hints to about 26 px and 7:1.
5. **Make "Larger" text noticeably larger.** 1.25 to 1.3, applied to the bar's status text too.
6. **Rename "Close" to "Later" on message cards and "OK" to "Done" on reminders.**
7. **Pick one verb for pointing, "press" or "tap," and use it everywhere.**
8. **Add "Forgot your PIN?" to the lock screen**, which sends a help request and shows the helper's number.

### Medium

1. **Show done reminders in the Today line with a check and the time.** Answers "did I already take them?"
2. **Low-battery cards at 15% and 5%**, in words, with the charger.
3. **A marker on a family face when that person has written**, until she opens the chat.
4. **Rename or remove the Telegram tile.** "Messages" or fold it into Family. Decide after watching her.
5. **"Put it back how it was" on the Colors page**, and theme changes in the weekly report.
6. **Real family photos and a Family page laid out for the real number of faces** before handover.
7. **Hesitation counts in the weekly report**: quick re-presses, Home from each app, More opened with no choice.

### Large

1. **A MomOS card between a family face and Telegram**, with "Write to Grace" and "Video call Grace," if watching shows Telegram's own screens are where she gets lost. This is the biggest remaining source of complexity she can reach.
2. **Trim More to the choices she actually uses**, after setting up her look together.
3. **Look at the web apps as closely as the shell.** Gmail, Facebook and YouTube are where she'll spend most of her time, and none were built for her. Check Chromium zoom per site, hover-only controls and scam ads that get past the blocker.

## Watching her use it

The goal is to see the computer through her eyes without her feeling examined. The research on stereotype threat says the watching itself can make her do worse, which would teach you the wrong lessons.

**Before handover.** Have her use it with you in the room for short stretches, doing things she wants to do anyway: look at photos of the grandkids, answer Grace, watch something on YouTube. Don't demonstrate first. Let her try, and step in only when she asks or has been stuck for a while. Say the design is new and you want to find the annoying parts.

**The first two weeks.** Mostly watch from a distance through the timeline, weekly report and help screenshots. Look for:

- Tiles opened and then abandoned within seconds, which means the tile wasn't what she expected.
- Repeated presses of Home, which can mean she's lost, or just that Home is working as her safe place. Look at the screenshots to tell which.
- Help requests that follow the same screen. Two from the same place is a design fix, not a lesson for her.
- Reminders that wait a long time for OK. The card may not be visible enough, or she may not be at the laptop at that hour.
- Changes to her theme or text size she didn't mention.

**On visits.** Sit beside her while she does something ordinary, not a set task. Watch where her eyes go first on the home screen, where the pointer hesitates, what she says under her breath and whether she reads the bar. Ask about the computer the way you'd ask about a new car: "What's annoying about it?" Not "Can you show me how to...?" If something goes wrong, blame the computer out loud, then write it down later.

**Things to try once each, casually.**

- Ask what the purple bar means, a few days after the first viewing session.
- Try the mouse for a few days.
- Show Simple and Colorful icons a week apart.
- At night, see whether she prefers Morning dimmed or Evening.
- Ask what she'd do if a website told her to call a number about a virus.

**What not to do.** Don't quiz her on procedures. Don't keep a list of her mistakes where she can see it. Don't change the layout in front of her without saying so, and don't change it often. Each change resets what she's learned. Batch changes, tell her what's different in one sentence, like "Your reminders now show a check when they're done", and then leave it alone for weeks.

The best sign is dull. She uses it every day, presses Get help when something is actually wrong, and talks about Grace's message rather than about the computer.

## Sources

**Standards and guidance**

- W3C, [Making content usable for people with cognitive and learning disabilities](https://www.w3.org/TR/coga-usable/) ([working draft](https://w3c.github.io/coga/content-usable/))
- W3C WAI, [Older users and web accessibility](https://www.w3.org/WAI/older-users) and [Developing websites for older people](https://www.w3.org/WAI/older-users/developing/)
- W3C, [Understanding target size (enhanced)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html), [Understanding animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html), [Text spacing summary](https://dequeuniversity.com/resources/wcag2.1/1.4.12-text-spacing)
- National Institute on Aging and National Library of Medicine, [Making your website senior friendly](https://sites.wip.nlm.nih.gov/pubs/techbull/ma12/ma12_seniorhealth.html)
- Alzheimer's Society, [Dementia and co-creation guide](https://www.alzheimers.org.uk/sites/default/files/2022-05/alzheimers-society-co-creation-guide.pdf)
- Apple, [Assistive Access announcement](https://www.apple.com/newsroom/2023/05/apple-previews-live-speech-personal-voice-and-more-new-accessibility-features/) and [WWDC23 "Meet Assistive Access" notes](https://wwdcnotes.com/documentation/wwdc23-10032-meet-assistive-access/)

**Nielsen Norman Group**

- Kane, [Usability for older adults: challenges and changes](https://www.nngroup.com/articles/usability-for-senior-citizens/), 2019
- [Memory recognition and recall in user interfaces](https://www.nngroup.com/articles/recognition-and-recall/)
- [Confirmation dialogs can prevent user errors](https://www.nngroup.com/articles/confirmation-dialog/) and [Consequential options close to benign options](https://www.nngroup.com/articles/proximity-consequential-options/)
- [User testing with older adults](https://www.nngroup.com/videos/user-testing-older-adults/)

**Vision**

- Owsley, Aging and vision, *Vision Research* 2011, discussed in [Age-related psychophysical changes and low vision](https://pmc.ncbi.nlm.nih.gov/articles/PMC3864381/)
- Piepenbrock, Mayr, Mund and Buchner, [Positive display polarity is advantageous for both younger and older adults](https://pubmed.ncbi.nlm.nih.gov/23654206/), *Ergonomics* 2013; [follow-up on small characters](https://journals.sagepub.com/doi/abs/10.1177/0018720813515509), *Human Factors* 2014
- Bernard, Liao and Mills, [The effects of font type and size on the legibility and reading time of online text by older adults](https://dl.acm.org/doi/10.1145/634067.634173), CHI 2001
- [Reduced eye optical quality contributes to worse chromatic thresholds in aging](https://www.frontiersin.org/journals/integrative-neuroscience/articles/10.3389/fnint.2023.1129315/full), 2023; [Spectral transmission of the human crystalline lens](https://iovs.arvojournals.org/article.aspx?articleid=2129060), IOVS

**Memory, attention and learning**

- Clapp, Rubens, Sabharwal and Gazzaley, [Deficit in switching between functional brain networks underlies the impact of multitasking on working memory in older adults](https://www.pnas.org/doi/full/10.1073/pnas.1015297108), PNAS 2011
- Clare and Jones, [Errorless learning in the rehabilitation of memory impairment](https://link.springer.com/article/10.1007/s11065-008-9051-4), *Neuropsychology Review* 2008
- Hedman, Nygård, Malinowsky, Almkvist and Kottorp, [Changing everyday activities and technology use in mild cognitive impairment](https://journals.sagepub.com/doi/abs/10.1177/0308022615586800), 2016; Malinowsky et al., [Ability to manage everyday technology](https://pubmed.ncbi.nlm.nih.gov/20545577/), 2010

**Pointing and targets**

- Hertzum and Hornbæk, [How age affects pointing with mouse and touchpad](https://mortenhertzum.dk/publ/IJHCI2010b.pdf), *IJHCI* 2010
- Findlater, Froehlich, Fattal, Wobbrock and Dastyar, [Age-related differences in performance with touchscreens compared to traditional mouse input](https://dl.acm.org/doi/10.1145/2470654.2470703), CHI 2013
- Jin, Plocher and Kiff, [Touch screen user interfaces for older adults: button size and spacing](https://link.springer.com/chapter/10.1007/978-3-540-73279-2_104), UAHCI 2007; W3C, [Summary of research on touch and pointer target size](https://www.w3.org/WAI/GL/mobile-a11y-tf/wiki/Summary_of_Research_on_Touch/Pointer_Target_Size)
- Hollinworth, [Improving computer interaction for older people: studying mouse clicks](https://centaur.reading.ac.uk/1118/1/sse_nic_hollinworth.doc)

**Attitudes, anxiety, stigma and language**

- Czaja et al., [Factors predicting the use of technology (CREATE)](https://www.researchgate.net/publication/7014155_Factors_Predicting_the_Use_of_Technology_Findings_From_the_Center_for_Research_and_Education_on_Aging_and_Technology_Enhancement_CREATE), *Psychology and Aging* 2006
- Wild et al., [Computer-related self-efficacy and anxiety in older adults with and without mild cognitive impairment](https://pubmed.ncbi.nlm.nih.gov/23102124/), 2012
- Vaportzis, Giatsi Clausen and Gow, [Older adults' perceptions of technology and barriers to interacting with tablet computers](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2017.01687/full), *Frontiers in Psychology* 2017
- Bichard, Coleman and Langdon, [Does my stigma look big in this?](https://researchonline.rca.ac.uk/362/1/Bichard_:_Langdon_HCII_07.pdf), UAHCI 2007
- Pullin, [Design Meets Disability](https://mitpress.mit.edu/9780262516747/design-meets-disability/), MIT Press 2009
- Li, Lee and Xu, [Stigma threat in design for older adults](http://ijdesign.org/index.php/IJDesign/article/view/3126/896), *International Journal of Design* 2020
- Renaud and van Biljon, [Worth-centred mobile phone design for older users](https://link.springer.com/article/10.1007/s10209-009-0177-9), *UAIS* 2010
- [Easierphone: participative development of a senior-friendly smartphone](https://www.scitepress.org/Papers/2023/119744/119744.pdf), 2023
- Mannheim et al., [Ageism in the discourse and practice of designing digital technology for older persons](https://pmc.ncbi.nlm.nih.gov/articles/PMC10448991/), *The Gerontologist* 2022
- Williams, Kemper and Hummert, [Enhancing communication with older adults: overcoming elderspeak](https://pubmed.ncbi.nlm.nih.gov/15960030/), 2004; Williams et al., [Elderspeak communication: impact on dementia care](https://pmc.ncbi.nlm.nih.gov/articles/mid/NIHMS172973/), 2009
- Peters, Calvo and Ryan, [Designing for motivation, engagement and wellbeing in digital experience](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2018.00797/full), *Frontiers in Psychology* 2018
- Reed, Mikels and Simon, [Older adults prefer less choice than young adults](https://pubmed.ncbi.nlm.nih.gov/18808256/), *Psychology and Aging* 2008; Mikels, Reed and Simon, [Older adults place lower value on choice relative to young adults](https://pmc.ncbi.nlm.nih.gov/articles/PMC2905131/), 2009
- Lamont, Swift and Abrams, [A review and meta-analysis of age-based stereotype threat](https://pubmed.ncbi.nlm.nih.gov/25621742/), *Psychology and Aging* 2015

**Help, monitoring and scams**

- Kiesler, Zdaniuk, Lundmark and Kraut, [Troubles with the internet: the dynamics of help at home](https://www.cs.cmu.edu/~kiesler/publications/2000pdfs/2000_troubles-with-internet-help-home.pdf), *Human-Computer Interaction* 2000
- Hänninen, Taipale and Luostari, [Exploring heterogeneous ICT use among older adults: the warm experts' perspective](https://journals.sagepub.com/doi/full/10.1177/1461444820917353), 2021; [Investigating the multifaceted role of warm experts in enhancing and hindering older adults' digital skills in Finland](https://www.tandfonline.com/doi/full/10.1080/02601370.2024.2353176), 2024
- Berridge and Wetle, [Why older adults and their children disagree about in-home surveillance technology, sensors, and tracking](https://pubmed.ncbi.nlm.nih.gov/31102442/), *The Gerontologist* 2020
- FBI IC3, [2024 annual report](https://www.ic3.gov/AnnualReport/Reports/2024_IC3Report.pdf)
- FTC, [Older adults hardest hit by tech support scams](https://www.ftc.gov/news-events/data-visualizations/data-spotlight/2019/03/older-adults-hardest-hit-tech-support-scams), 2019

**Commercial products mentioned**

- [TechRadar review of GrandPad](https://www.techradar.com/reviews/grandpad)
- [Guide to Samsung Easy Mode](https://eldrio.com/how-to-turn-on-old-people-mode-on-samsung)
