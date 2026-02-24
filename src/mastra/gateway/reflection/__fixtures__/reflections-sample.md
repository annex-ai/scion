# Reflections

## Patterns

### Attention Signals

- User references previous deployment configuration details (confidence: 0.85, occurrences: 1, evidence: Message mentioned nginx config from last week discussion)
- User asks about database migration steps repeatedly (confidence: 0.78, occurrences: 3, evidence: Three separate messages asking about migration status)
- User mentions specific team member names when discussing code reviews (confidence: 0.72, occurrences: 2, evidence: Referenced @alice and @bob in review context)

### Decision Markers

- Chose to use environment variables over hardcoded config (confidence: 0.90, occurrences: 1, evidence: Explicit statement preferring env vars for security)
- Selected PostgreSQL over SQLite for production database (confidence: 0.88, occurrences: 1, evidence: User compared both options and chose PostgreSQL)

### Noise Patterns

- Off-topic discussion about lunch plans (confidence: 0.95, occurrences: 4, evidence: Multiple messages about food unrelated to task)
- Repeated greeting messages without substance (confidence: 0.92, occurrences: 6, evidence: Hello/hi messages with no follow-up question)
- Auto-generated status update notifications (confidence: 0.89, occurrences: 8, evidence: Bot-generated CI/CD status messages)

## Heuristics

- **heuristic_1**: message contains deployment keywords → boost relevance score (weight: 0.5)
- **heuristic_2**: user references previous conversation → increase context window (weight: 0.4)
- **heuristic_3**: message is greeting only → reduce priority (weight: 0.3)
- **heuristic_4**: user asks about migration → flag for follow-up (weight: 0.6)
- **heuristic_5**: message mentions team members → tag as collaborative (weight: 0.35)
- **heuristic_6**: user makes explicit choice → record as decision (weight: 0.7)
- **heuristic_7**: message is auto-generated → mark as noise (weight: 0.2)
- **heuristic_8**: user references config files → boost technical relevance (weight: 0.45)
