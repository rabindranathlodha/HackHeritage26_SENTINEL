# Remix of Remix of SENTINEL Wellspring

Build a production-quality frontend for SENTINEL — Stress Evaluation & Notification Through Integrated Longitudinal Analysis, a privacy-first personal stress and wellness management Progressive Web App for the personnel side of the system.



This frontend must follow the SENTINEL MVP Build Specification exactly, particularly the privacy and trust principles in Section 9.1.



1. TECHNOLOGY REQUIREMENTS



Use ONLY the following primary frontend technology stack:



- Next.js 15

- App Router

- React 19

- TypeScript

- Tailwind CSS

- shadcn/ui

- Lucide React icons

- React Hook Form

- Zod

- Recharts where charts are required

- Motion / Framer Motion for subtle animations

- next-pwa / Workbox for PWA and offline support



Do NOT build this as plain HTML/CSS/JavaScript.

Do NOT use React + Vite.

Do NOT use Bootstrap.

Do NOT use Material UI.

Do NOT create unnecessary backend logic inside the frontend.



The project should be component-based, reusable, responsive and production-ready.



Use Server Components by default and Client Components only where interaction is required, such as forms, animations, charts and interactive controls.



2. PRODUCT IDENTITY



Product name:



SENTINEL



Tagline:



"Your wellbeing. Your privacy. Your choice."



The application is a personal wellness companion, NOT a surveillance dashboard.



The entire interface should communicate:



- Safety

- Privacy

- Calmness

- Trust

- Human support

- Modern technology

- Professionalism

- Confidentiality



The user should immediately feel:



"I can talk about how I am feeling here without being judged."



Avoid anything that looks like:



- Military surveillance software

- Police control room

- Hospital emergency dashboard

- Corporate HR software

- Aggressive AI interface

- Dark cyber-security dashboard



This is a wellness product first.



---



3. VISUAL DESIGN DIRECTION



Create a modern 2026-style wellness technology interface.



Design inspiration should combine:



- Premium health-tech SaaS

- Calm wellness applications

- Modern AI products

- Minimal editorial landing pages

- Bento-grid layouts

- Soft glassmorphism used sparingly

- Organic shapes

- Generous whitespace

- Subtle gradients

- Micro-interactions

- Smooth scroll animations

- Soft shadows

- Rounded cards

- Clean typography



The design should feel similar in quality to a premium startup product rather than a college project.



IMPORTANT:



Do NOT overuse glassmorphism.



Do NOT put every component inside a floating glass card.



Use glass effects only for selected hero elements, navigation or highlighted privacy cards.



---



4. COLOR SYSTEM



The primary visual identity should be based around a technology-green wellness palette.



Primary:



- Deep forest green

- Emerald

- Fresh wellness green

- Soft mint



Background:



- Warm off-white

- Very light green-tinted white

- Soft neutral surfaces



Text:



- Deep charcoal / near-black

- Muted slate green for secondary text



Use lava red / warm coral-red only as a controlled accent, NOT as the primary brand color.



Use lava red for:



- Important alert states

- Warning indicators

- Small visual accents

- Stress-related attention states

- Micro highlights



Do NOT make the entire application red.



Example conceptual palette:



Forest Green → primary brand

Emerald → interactive state

Mint → wellness background

Warm White → main background

Charcoal → primary text

Lava Red → alert/accent



The red should communicate "pay attention" rather than "danger/panic."



---



5. TYPOGRAPHY



Use a modern sans-serif typeface such as:



- Geist

- Inter

- Manrope



Use strong typography hierarchy.



Hero heading:



Large, bold, elegant and highly readable.



Example:



"Take a moment.

Check in with yourself."



Supporting copy should be calm and human.



Avoid excessive uppercase text.



Avoid overly technical terminology in the personnel-facing interface.



---



6. LANDING / HOME SCREEN



Create a premium hero section.



Hero concept:



Small badge:



"PRIVATE WELLNESS COMPANION"



Main heading:



"Your wellbeing deserves a private space."



Supporting text:



"Take a few minutes to check in, understand how you're feeling, and keep your wellbeing journey in your hands."



Primary CTA:



"Start weekly check-in"



Secondary CTA:



"How your privacy works"



Hero visual:



Create an elegant floating wellness interface/mockup showing:



- Current wellbeing state

- Weekly check-in progress

- Small mood visualization

- Privacy indicator

- "Your data stays protected" message



Use subtle floating animations.



Add a soft green radial gradient / organic blob behind the hero.



Do NOT use cheesy stock photos.



Prefer abstract wellness graphics, subtle 3D forms, soft gradients or UI-based visual storytelling.



---



7. PRIVACY-FIRST DESIGN — MOST IMPORTANT



This frontend represents the principles from SENTINEL Section 9.1.



Privacy must not be hidden inside a settings page.



Make privacy visible throughout the user journey.



Create a persistent subtle privacy indicator:



"Private by design"



with a small shield/lock icon.



Clicking it opens a shadcn Dialog/Sheet explaining:



"Your information is yours."



Show three simple principles:



1. Your choice

2. Your data

3. Your privacy



Explain that participation in self-assessment is voluntary.



Use human language rather than legal jargon.



---



8. CONSENT-FIRST FLOW



Before the first assessment, create a clear consent screen.



Heading:



"You're in control."



Explain:



"This check-in is voluntary. You choose what you share and how your information is used."



Provide clearly separated options:



[ Continue with check-in ]



[ Skip for now ]



Never use manipulative dark patterns.



The user must be able to understand:



- What data is collected

- Why it is collected

- What is processed on the device

- What leaves the device

- Who can access what

- That the service can work without optional self-assessment



Use shadcn:



- Card

- Checkbox

- Switch

- Dialog

- Button

- Accordion



---



9. PERSONAL DASHBOARD



After login, create a calm personal dashboard.



Top navigation:



SENTINEL logo



Home

Check-in

My wellbeing

Privacy



Profile/avatar



Main greeting:



"Good evening."



Subheading:



"Take a moment to see how you're doing."



Hero dashboard card:



"How are you feeling today?"



CTA:



"Start check-in"



Show a weekly wellbeing overview.



Possible cards:



- Weekly check-in

- Current wellbeing trend

- Recent reflection

- Privacy status



Do NOT show a frightening "risk score."



Never display language such as:



"You are at risk."



Instead use supportive language such as:



"Your recent check-ins show some changes worth paying attention to."



The interface must avoid stigmatizing the user.



---



10. WEEKLY SELF-ASSESSMENT



Create a beautiful, focused questionnaire experience.



Do not show all questions at once.



Use one question per screen or a small number of questions per step.



Show progress:



Question 3 of 8



Progress bar should be subtle.



Example:



"Over the past week, how often have you felt overwhelmed by your responsibilities?"



Use accessible Likert-scale controls.



Possible options:



Never

Rarely

Sometimes

Often

Very often



Use large touch-friendly buttons.



When an option is selected:



- subtle scale animation

- soft highlight

- check icon

- no distracting effects



Add:



"Your responses are private."



at appropriate points.



Include back/next navigation.



---



11. JOURNAL / REFLECTION



After the questionnaire, allow optional reflection.



Heading:



"Anything you'd like to put into words?"



Text:



"You can write something here if you'd like. This is completely optional."



Large textarea.



Add voice-note UI as an optional feature:



"Record a voice note"



with microphone icon.



The interface must clearly say:



"Optional"



Do not force the user to write something.



---



12. PRIVACY EXPLANATION DURING JOURNAL ENTRY



Because SENTINEL uses on-device preprocessing, visually communicate this concept.



Create a small privacy card:



"Processed privately"



"Your raw reflection is processed on your device before anything is transmitted."



Use a small device + shield illustration.



The UI should explain this without exposing technical ML terminology.



Do not claim that raw content never leaves the device unless the actual implementation guarantees this.



If the feature is only mocked for the MVP, label it appropriately.



---



13. CHECK-IN COMPLETION



After submission, do NOT display an alarming score.



Instead create a calm completion screen.



Example:



"Check-in complete."



"Thank you for taking a moment for yourself."



Show a subtle animated checkmark.



Then:



"Your wellbeing snapshot has been updated."



Optional supportive card:



"Small steps matter."



Provide:



"View my wellbeing"



and



"Return home"



---



14. WELLBEING TREND SCREEN



Create a personal trend page.



Use Recharts.



Show:



- Weekly check-in trend

- Mood/wellbeing trend

- Reflection frequency



Use smooth line charts.



Keep chart design minimal.



Do not create complicated medical graphs.



Do not imply medical diagnosis.



Instead of red danger zones, use neutral language:



"Your recent pattern"



"Changes over time"



"Your check-in history"



Add explanatory text:



"These trends are intended to help you reflect on your wellbeing. They are not a diagnosis."



---



15. PRIVACY CENTER



Create a dedicated Privacy Center.



This should be one of the strongest screens because Section 9.1 makes privacy a core architecture principle.



Sections:



What you share



Show:



- Weekly check-in responses

- Optional reflection

- Optional voice note

- Basic account information



What is processed



Show a visual pipeline:



Your device

↓

Private processing

↓

Derived signal

↓

Secure service



Who can see what



Explain in simple terms:



"Your personal information is not presented to commanders as an individual wellness score."



Your choices



Controls:



- Self-assessment participation

- Optional voice notes

- Optional journal

- Data transparency



Access history



Show a simple audit-style list if supported by backend.



Example:



"Wellbeing information accessed"



"Today · Welfare support system"



Keep this transparent and understandable.



---



16. PRIVACY VISUAL LANGUAGE



Create a reusable PrivacyBadge component.



Examples:



<PrivacyBadge>Private by design</PrivacyBadge>



<PrivacyBadge>Optional</PrivacyBadge>



<PrivacyBadge>Processed on device</PrivacyBadge>



Use these consistently across the application.



Also create:



PrivacyCard

ConsentDialog

DataUsageSheet

PrivacyIndicator

AccessHistoryCard



All should be reusable TypeScript components.



---



17. MICRO-INTERACTIONS



Use Motion / Framer Motion carefully.



Implement:



- Page fade-in

- Staggered hero entrance

- Card hover lift

- Button press feedback

- Smooth questionnaire transitions

- Progress bar animation

- Checkmark completion animation

- Floating hero objects

- Subtle blob movement

- Chart entrance animation

- Sheet/dialog transitions



Animations must be:



- Fast

- Calm

- Purposeful



Avoid:



- Excessive bouncing

- Huge zoom effects

- Distracting parallax

- Constant motion



Respect prefers-reduced-motion.



---



18. TRENDING UI PATTERNS TO USE



Use modern patterns such as:



Bento Grid



Use a bento layout for the landing page feature section.



Cards:



Privacy

Weekly check-in

Personal trends

Offline support



Each card should have different visual weight.



Interactive Hero



Create a hero UI mockup rather than just text.



Soft Gradient Mesh



Use very subtle green gradients.



Organic Shapes



Use rounded blobs inspired by wellness/nature rather than sharp technology shapes.



Scroll Reveal



Sections should reveal smoothly while scrolling.



Floating UI Cards



Use a few floating cards around the hero.



Editorial Typography



Use large expressive headings with short supporting copy.



Minimal Navigation



Keep navigation extremely clean.



---



19. RESPONSIVE DESIGN



Mobile-first is mandatory.



The primary target is a phone because this is a Personnel Companion PWA.



Design for:



360px

390px

430px

768px

1024px

1440px+



On mobile:



- Bottom navigation is acceptable

- Large touch targets

- One-column layout

- Questionnaire occupies most of screen

- CTA remains easy to reach



On desktop:



- Centered max-width container

- More generous whitespace

- Two-column hero

- Bento grid

- Dashboard cards



Use Tailwind responsive utilities rather than separate CSS layouts.



---



20. PWA REQUIREMENTS



Configure the application as an installable PWA.



Include:



- Web app manifest

- Service worker

- Offline fallback

- Installable experience

- Offline questionnaire queue concept

- Sync when connection returns



The user should be able to open the app even with poor connectivity.



If a submission is temporarily offline, show:



"Saved securely on this device. We'll sync when you're back online."



Do not make false security claims unless the implementation actually provides encryption/storage guarantees.



---



21. COMPONENT ARCHITECTURE



Create reusable components such as:



components/

ui/

layout/

privacy/

wellness/

assessment/

charts/

navigation/



Example components:



Navbar

MobileNav

HeroSection

PrivacyBadge

PrivacyCard

ConsentDialog

CheckInCard

QuestionCard

ProgressIndicator

LikertScale

JournalInput

VoiceNoteButton

WellbeingTrend

CompletionCard

PrivacyCenter

DataUsageSheet

OfflineStatus

Footer



Use TypeScript interfaces/types for component props.



Avoid putting the entire application into one page.tsx file.



---



22. ACCESSIBILITY



Follow accessible UI practices.



Requirements:



- Semantic HTML

- Keyboard navigation

- Proper labels

- ARIA where necessary

- High contrast

- Large touch targets

- Focus states

- Screen-reader-friendly forms

- Reduced motion support



Do not rely only on green/red colors to communicate status.



---



23. SECURITY / PRIVACY FRONTEND RULES



NEVER:



- Put API secrets in frontend code

- Put private keys in NEXT_PUBLIC variables

- Directly expose FastAPI to the browser

- Show raw personal data unnecessarily

- Display individual risk information to unauthorized roles

- Store sensitive information in localStorage unless explicitly required and appropriately protected

- Fake security features in the UI



The browser should communicate with the Next.js API layer.



---



24. DEMO MODE



Because this is an SIH MVP, create a polished demo experience using clearly identified synthetic/mock data where backend integration is unavailable.



Do NOT present synthetic information as real personnel data.



Include a small developer/demo configuration that allows the team to demonstrate:



1. User opens SENTINEL

2. User completes check-in

3. User optionally writes reflection

4. Submission state changes

5. Wellbeing trend updates

6. Privacy explanation is shown

7. Offline state can be demonstrated



---



25. LANDING PAGE STRUCTURE



Create this exact high-level flow:



NAVBAR



↓

HERO



"Your wellbeing deserves a private space."



CTA: Start your check-in



↓

TRUST / PRIVACY STRIP



"Private by design · Voluntary · Built around your choice"



↓

BENTO FEATURES



Private by design

Weekly check-ins

Personal trends

Works with limited connectivity



↓

HOW IT WORKS



1. Check in

2. Your device processes what it can locally

3. Secure signals help build a longitudinal picture

4. You stay informed about your data



↓

PRIVACY SECTION



"Technology should help you feel supported — not watched."



Explain the welfare-not-surveillance philosophy.



↓

PERSONAL WELLBEING PREVIEW



Interactive dashboard mockup.



↓

FINAL CTA



"Take a moment for yourself."



Button:



"Start your check-in"



↓

FOOTER



SENTINEL

Privacy

Data usage

Support

About



---



26. DESIGN QUALITY BAR



The final interface must look like a real 2026 health-tech startup product.



Think:



Calm + premium + futuristic + human.



NOT:



Generic Tailwind template

Generic hospital website

Generic dashboard

Overly colorful mental-health app

Cybersecurity interface

Military surveillance interface



The green technology theme should dominate the experience.



Use lava-red sparingly as an accent for attention states.



The final design should be visually impressive enough for an SIH judge demo while remaining credible and privacy-focused.



---



27. CODE QUALITY



Use:



- TypeScript

- Reusable components

- Clean folder structure

- Proper naming

- No unnecessary dependencies

- No duplicated UI

- Responsive Tailwind classes

- shadcn/ui components

- Accessible forms

- Environment variables for API configuration

- Clean loading/error/empty states



Provide realistic loading states and error states.



Do not leave buttons non-functional.



Where backend APIs are not yet available, create a clearly isolated mock service layer so it can later be replaced with real API calls.



---



28. FINAL OUTPUT



Generate the complete frontend implementation.



Start with the landing page and personnel PWA experience.



Prioritize:



1. Privacy-first UX

2. Weekly check-in

3. Personal wellbeing dashboard

4. Privacy Center

5. Responsive mobile experience

6. Premium modern visual design

7. PWA readiness

8. Reusable components



The result should feel like a polished, trustworthy, privacy-first personal stress-management companion rather than an AI surveillance product.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://sentinel-calm-space.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/301feec2-c1e0-4e20-8d2c-2f9642dcec4c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
