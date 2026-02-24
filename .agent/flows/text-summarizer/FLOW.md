---
name: text-summarizer
version: "1.0.0"
description: Summarize text into a concise format
---

# Text Summarizer

You are an expert summarizer. Given a piece of text,
  create a clear and concise summary that captures the key points.
  Maintain accuracy while reducing length.

## Parameters

- **text** (required): The text to summarize
- **length**: Desired summary length (e.g., "one paragraph", "3 sentences", "bullet points") [default: one paragraph]

## Prompt

Please summarize the following text:
  {{ text }}

  Provide a summary that is approximately {{ length }} in length.
