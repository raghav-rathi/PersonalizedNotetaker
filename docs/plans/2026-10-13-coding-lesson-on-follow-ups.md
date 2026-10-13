# Coding lesson on Follow-ups Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** In a coding round, Main stays the approach and the answer you say and type, and Follow-ups teaches that same step as if you do not know DSA, without pulling the overlay off Main.

**Architecture:** One model reply still starts with `LANE: MAIN`. A `TEACH:` line, the same shape as today's `UPDATE:` line, splits the lesson off the main card. The app already knows how to open a second card with `focus: false` (the "Changed after" card), so the lesson is a side card that increments the Follow-ups badge and leaves the current screen alone. Interviewer questions stay `LANE: SIDE`, still jump to Follow-ups, and start with **They asked**. Interview mode, Analyze Screen, and the LLD prompt do not use `TEACH:`.

**Tech Stack:** Node test runner (`node --test`), Electron overlay, the DSA skill at `src/prompts/dsa-coding-skill.md`.

---

## What stays put

- `LANE: MAIN`, `LANE: SIDE`, `LANE: NONE`, and `UPDATE:` keep their current jobs.
- `src/utils/answerLanes.js` `LANE_INSTRUCTION` is the interview-mode router. Do not mention `TEACH:` there.
- `src/utils/analyzeScreenSend.js` is the one-shot screen prompt. Leave it.
- `src/utils/prompts.js` `lld` is the design-round prompt. Leave it.
- Type-along reads only the focused Main card (`CheatingDaddyApp._typeAlongView`). Stripping `TEACH:` off the main text is what keeps the lesson out of the typing strip.
- The full raw reply, marker included, stays on `codingTurn.reply` so the next coding turn can see the lesson it already gave.

## Reply shape the model must produce

A coding step:

```text
LANE: MAIN
**Part 1: clarify and simple version**

I get a list of numbers and a target. I return the two indices that add up to it.

```text
Simple
# check every pair, because I only need any two that add up
for i in 0..n-1:
  for j in i+1..n-1:
    if nums[i] + nums[j] == target: return i, j
```

That's the slow version. Want me to make it faster?

TEACH:
You do not need the name yet. By hand, you would point at 2, then try 7, 11, and 15 until one pair adds to 9. That is a lot of pointing once the list is long, because every number looks at every number after it. A notebook from "the other number I still need" to "where I saw it" lets you check each number once. The pad on Main is the pointing version. The notebook is the next step.
```

An interviewer question, unchanged route, new heading:

```text
LANE: SIDE
**They asked**

A set is a bag of values with no duplicates. "Have I seen this?" is one look, instead of scanning the whole list again.
```

`TEACH:` inside a code fence is not a marker. Same rule `UPDATE:` already has.

---

### Task 1: Split a main coding reply at `TEACH:`

**Files:**
- Modify: `src/utils/answerLanes.js`
- Test: `src/utils/answerLanes.test.js`

**Step 1: Write the failing test**

Add this test to `src/utils/answerLanes.test.js` and import `splitMainLesson` next to `splitSideUpdate`.

```javascript
test('a main coding reply splits the lesson at a TEACH line outside code', () => {
    const body = [
        '**Part 1: clarify and simple version**',
        'I check every pair.',
        '```text',
        'TEACH:',
        '```',
        'TEACH:',
        'By hand you point at each pair.',
    ].join('\n');
    assert.deepEqual(splitMainLesson(body), {
        answer: ['**Part 1: clarify and simple version**', 'I check every pair.', '```text', 'TEACH:', '```'].join('\n'),
        lesson: 'By hand you point at each pair.',
    });
    assert.deepEqual(splitMainLesson('Just the script.'), { answer: 'Just the script.', lesson: null });
});
```

**Step 2: Run the test to verify it fails**

Run: `node --test src/utils/answerLanes.test.js`

Expected: FAIL with `splitMainLesson is not a function` or `splitMainLesson is not defined`.

**Step 3: Write the minimal implementation**

In `src/utils/answerLanes.js`, add the marker next to `UPDATE_MARKER` and a splitter that copies `splitSideUpdate` with the new marker. Export `splitMainLesson`.

```javascript
const TEACH_MARKER = /^\s*[*_]*TEACH[*_]*\s*:\s*[*_]*\s*$/i;

/**
 * Splits the script the user says from the beginner lesson that follows a "TEACH:" line.
 * The marker only counts outside code fences, same as UPDATE.
 * @param {string} body
 * @returns {{answer:string, lesson:string|null}}
 */
function splitMainLesson(body) {
    const lines = String(body || '').split('\n');
    let inFence = false;
    for (let index = 0; index < lines.length; index++) {
        if (/^\s*```/.test(lines[index])) inFence = !inFence;
        else if (!inFence && TEACH_MARKER.test(lines[index])) {
            return {
                answer: lines.slice(0, index).join('\n').trimEnd(),
                lesson: lines
                    .slice(index + 1)
                    .join('\n')
                    .replace(/^\s*\n/, '')
                    .trimEnd(),
            };
        }
    }
    return { answer: String(body || ''), lesson: null };
}
```

Add `splitMainLesson` to `module.exports`.

**Step 4: Run the test to verify it passes**

Run: `node --test src/utils/answerLanes.test.js`

Expected: PASS, including the existing `UPDATE:` test.

**Step 5: Commit**

```bash
git add src/utils/answerLanes.js src/utils/answerLanes.test.js
git commit -m "feat: split a coding reply's lesson from the script"
```

---

### Task 2: Show the lesson on Follow-ups without leaving Main

**Files:**
- Modify: `src/utils/gemini.js` (`streamLanedAnswer`, around the `split` helper near line 701)
- Test: `src/utils/answerLanes.test.js` (the splitter from Task 1 is the unit under test; this task only wires it)

No new UI. `createAnswerStream` already sends `focus`, and `CheatingDaddyApp._placeNewCard` already skips the screen switch when `focus` is false and bumps the other tab's "new" count.

**Step 1: Change the coding split**

Replace the `split` line inside `streamLanedAnswer`:

```javascript
const split = body => {
    if (!codingTurn) return { answer: body, update: null, lesson: null };
    if (lane === 'side') return { ...splitSideUpdate(body), lesson: null };
    const { answer, lesson } = splitMainLesson(body);
    return { answer, update: null, lesson };
};
```

Import `splitMainLesson` from `./answerLanes`.

**Step 2: Open the lesson card**

Inside `show`, after the existing `update` block, add:

```javascript
if (lesson?.trim()) {
    lessonCard ||= createAnswerStream('lesson', {
        sequenceBase,
        lane: 'side',
        label: `Lesson: ${shortLabel(label, 50)}`,
        focus: false,
    });
    lessonCard.update(formatAnswerForDisplay(lesson));
}
```

Declare `let lessonCard = null;` next to `let changedCard = null;`.

In the completion block, next to `changedCard.complete`:

```javascript
if (lessonCard && lesson?.trim()) lessonCard.complete(formatAnswerForDisplay(lesson.trim()));
```

`lesson` there is the one from `const { answer, update, lesson } = split(body);`, so rename the completion destructure to include `lesson`.

Pass `answer` (the script only) to `recordConversationTurn`, not the raw body, so history does not show the `TEACH:` marker. Keep `codingTurn.reply = result.text` as the full raw reply.

**Step 3: Run the lane tests again**

Run: `node --test src/utils/answerLanes.test.js src/utils/answerEvents.test.js`

Expected: PASS. `answerEvents` has no lesson case; this confirms the event helper still accepts a side card with a label.

**Step 4: Commit**

```bash
git add src/utils/gemini.js
git commit -m "feat: show the coding lesson on Follow-ups without leaving Main"
```

---

### Task 3: Rewrite the coding skill so Main is the script and Follow-ups is the lesson

**Files:**
- Modify: `src/prompts/dsa-coding-skill.md`

This is the behavior change. The app only displays what the model writes.

**Step 1: Replace the opening identity**

Replace the first paragraph with:

```markdown
You are the candidate in a live coding interview for an SDE-2 role, and you are also my tutor. I do not know DSA. You write two things in every step of the solution. Main is the script: the words I say and the code I type, short enough to read out loud. Follow-ups is the lesson: the same step taught as if I have never seen the pattern. I read Main while I talk and type. I open Follow-ups when I need to understand it. The interviewer sees the editor, never the overlay.
```

**Step 2: Add the marker to "How a reply looks"**

After the `LISTEN` / `ACTION` bullets, add:

```markdown
A MAIN step ends the script, then a line with only `TEACH:`, then the lesson. The app puts everything before `TEACH:` on Main and everything after it on Follow-ups, and it stays on Main. Write `TEACH:` only on `LANE: MAIN` steps: Part 1, Part 2, each code hop, full code, and dry run. Never put `TEACH:` inside a code fence. A SIDE reply has no `TEACH:` block.

The lesson assumes I do not know the pattern, the data structure, or the textbook name. Teach it on the example's own numbers, in this order: what I would do by hand, why that gets slow, the trick in one sentence a friend would use, the name only after that sentence, then which lines on Main are that trick. Do not repeat the script. Do not give a second copy of the code.
```

**Step 3: Shorten what Main is allowed to be**

In Part 1, Part 2, and Part 3, keep the beats and the pads, and add one rule under each heading:

- Part 1 and Part 2: the spoken script stays, then `TEACH:` with the full lesson (hand version, why it is slow, the trick, the name, which pad lines). About half a screen. This is where the teaching is long.
- Part 3 hops: the spoken lines stay one or two sentences about the decision. `TEACH:` explains only the new lines in that hop, in two to four sentences. Do not reteach the whole approach.
- Full code: `TEACH:` is three sentences: what the function does on the example, which hop does the real work, and the cost in plain words.
- Dry run: `TEACH:` is the trace told as the story of the example, one sentence per trace line, no new code.

Add this under "The flow":

```markdown
Every MAIN step includes `TEACH:`. If I already heard the lesson for this idea, the new lesson only covers what this step adds.
```

**Step 4: Mark interviewer questions**

Replace the SIDE intro sentence with:

```markdown
Start the answer with **They asked**, then only what they asked, in one to four sentences I can say. Use a plain definition the first time a structure comes up ("a heap is the thing that always hands me the smallest"). Don't repeat the lesson already on Follow-ups, don't repeat the main answer, don't replay hops, and don't recap the problem.
```

Keep the complexity, line, trade-off, hint, failing-test, and bad-audio bullets. Keep `UPDATE:` exactly as it is.

**Step 5: Split the voice section**

Under `## Voice`, add:

```markdown
Main sounds like me talking to the interviewer: "I need to check...", "the slow part is...", "what I really need is...". Short. No lecture.

The lesson sounds like a friend who knows I have not studied this. "By hand you would...", "that gets slow because...", "the trick is...". It can be longer than Main on Part 1 and Part 2. It never says "the optimal approach", "this is a classic", "key insight", "let's break this down", or "as you know".
```

Keep the existing Don't-say / Say-instead table. It applies to both blocks.

**Step 6: Add one example**

Under `## Examples`, before the code hop, add a Part 1 example that contains `TEACH:` outside the fence, and change the no-code follow-up example so it starts with `**They asked**`. Leave the `UPDATE:` example and the `LANE: NONE` example as they are.

**Step 7: Commit**

```bash
git add src/prompts/dsa-coding-skill.md
git commit -m "feat: teach coding steps on Follow-ups and keep Main as the script"
```

---

### Task 4: Document the two tabs in a coding round

**Files:**
- Modify: `docs/how-to-use.md` (the coding-round list, step 2 and step 9)
- Modify: `README.md` (the "Coding mode" section)

**Step 1: Update the guide**

In `docs/how-to-use.md`, add to step 2 that Part 1 on Main is what you say and type, and a lesson for that step appears on Follow-ups. The overlay stays on Main. The Follow-ups tab shows a "new" count. `Cmd+Option+Right` opens the lesson, `Cmd+Option+Left` returns to the same Main card.

In step 9, say the interviewer question is titled **They asked** and does jump to Follow-ups. The lesson cards stay in the list above it.

Add the same two facts to the README "Coding mode" bullets, in one or two sentences.

**Step 2: Commit**

```bash
git add docs/how-to-use.md README.md
git commit -m "docs: describe the coding lesson on Follow-ups"
```

---

## Manual check

Start a session, put a small array problem on screen, press `Cmd+Option+1`.

- Main shows the Part 1 script and the Simple pad. It does not show `TEACH:` or the lesson.
- The overlay stays on Main. Follow-ups shows a new count.
- Follow-ups has one lesson card that explains the hand version, why it is slow, and the trick, and points at the pad.
- `Cmd+Option+3` adds a hop on Main and a short lesson that only explains the new lines.
- Type-along lists lines from the pad or the code, not lines from the lesson.
- Saying "why a set?" adds a **They asked** card and the overlay moves to Follow-ups. Main does not move.

## Out of scope

- Changing interview answers, Analyze Screen, or the LLD prompt.
- Replacing the previous lesson card. Lessons stack, like Main steps.
- A second model call. One reply fills both tabs.
