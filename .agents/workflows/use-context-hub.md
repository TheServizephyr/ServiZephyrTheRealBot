---
description: How to fetch the latest API documentation using Context Hub
---
Use this workflow when you need documentation for a third-party library, SDK, or API before writing code that uses it. Fetch the docs with `chub` rather than relying on training knowledge.

1. **Find the right doc ID:**
```bash
// turbo
chub search "<library name>"
```
Pick the best-matching `id`.

2. **Fetch the docs:**
```bash
// turbo
chub get <id> --lang <py/js/ts>
```
Omit `--lang` if the doc has only one language variant.

3. **Use the docs:**
Read the fetched content and use it to write accurate code.

4. **Annotate what you learned:**
```bash
// turbo
chub annotate <id> "Webhook verification requires raw body"
```

5. **Give feedback:**
```bash
// turbo
chub feedback <id> up
```
