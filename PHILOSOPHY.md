# Philosophy

First Person Tales is built around one idea: **the player should see and
control the whole story, and the game should never do more than the player
asked for.**

A single turn is a single narrator call. There is no hidden memory update, no
background summarization, no silent retry that could charge twice. What you
see is what the narrator saw; what the narrator saw is what you can still see,
edit, and correct.

## Principles

1. **One call per turn.** Sending a turn makes exactly one narrator request.
   Summaries, translations, improvements, and images happen only when you
   explicitly trigger them. The game never summarises your history, drops
   context, generates an image, or repeats an uncertain paid request on its
   own.

2. **The story is visible and editable.** The full history stays on screen.
   You can edit a past turn, regenerate a reply, resend from a point, or
   delete everything after a message. Nothing is locked away where you cannot
   see or fix it.

3. **No surprise costs.** Every request that reaches Venice is one you made on
   purpose. If a connection drops in the middle of a paid request, the game
   reports the uncertainty instead of retrying and possibly billing twice.

4. **Local-first.** Your story, settings, and images live in `data/` on your
   own machine (Git-ignored), and you can export or import a JSON save without
   exporting the credential. The API key lives in the current user's native OS
   keychain, or comes from `VENICE_API_KEY`. The game is meant for one player
   on their own computer, never exposed to a network.

5. **The player keeps the steering wheel.** Out-of-character `[OOC: ...]`
   notes tell the narrator how to steer the scene. The prompts are plain text
   files you can read and edit, and your personal character lives in an
   ignored local override rather than inside the shared prompts.

6. **One active character at a time.** A single character sheet accompanies
   narrator, summary, and image-prompt preparation requests. Change the
   character before a new story, not mid-story.
