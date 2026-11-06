@AGENTS.md

# Markup

<!-- What this app does and who it's for, in a sentence or two. -->

## Commands

- `npm run dev`: start the dev server
- `npm run build`: production build
- `npm run lint`: run ESLint
- `npm test`: run the tests in `app/utils/*.test.mjs`

## Project layout

- `app/components/`: UI components
- `app/context/`: app state provider and hooks
- `app/hooks/`: shared hooks
- `app/types/`: shared types
- `app/utils/`: helpers and their tests
- `app/workers/`: web workers
- `scripts/`: build and install scripts
- `public/pdfjs/`: PDF.js assets, copied in by `postinstall`

## How to build

Think like the end user, who may have used similar software or none at all.

- **Intuitive:** everything should be easy to find and understand.
- **Quick to reach:** items and options should be one or two clicks away.
- **Fast:** the flow of operations should feel quick and snappy.
- **Focused:** options are good, but too many are bad. Add what is needed, not every nice-to-have.

## How to work with me

- **Ask first:** ask questions before starting. Check with me before making design changes or adding feature ideas.
- **Suggest additions for new tools:** when I ask for a new tool rather than a quick update, think about what would make it better and suggest those additions. Good past examples are the line tool's midpoint and the right-click options on objects.

## Conventions

<!-- Code style, naming, and patterns to follow. -->

## Things to watch out for

<!-- Gotchas, fragile areas, and things not to change. -->

## Testing a change

Try to break the change, learn from what fails, and fix it. Test the edge cases where it is most likely to break, for example:

- Add an item off the canvas.
- Right-click an item at the edge of the canvas and check whether the menu appears in front of or behind the canvas.

## Notes
- Unless I specifically ask to commit to a new branch. Use the main branch
<!-- Anything else worth remembering. -->
