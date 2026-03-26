# opencode-insights

A tool for extracting insights from opencode sessions.

## Installation

```bash
npm install -g opencode-insights
```

## Usage

```bash
# Generate insights report for the last 30 days
opencode-insights

# Generate insights report for the last 7 days
opencode-insights --days 7
```

## Features

- Analyzes opencode sessions for workflow insights
- Extracts code quality patterns
- Identifies friction points in development workflow
- Provides actionable recommendations
- Shows project and team productivity trends

## Structure

The tool is organized into the following modules:
- `reader.ts`: Reads sessions from opencode database
- `extractor.ts`: Extracts insights from individual sessions
- `aggregator.ts`: Combines insights into comprehensive reports
- `reporter.ts`: Formats and outputs the final report
- `llm.ts`: Interacts with language models for deeper analysis
- `config.ts`: Reads opencode configuration
- `database.ts`: Manages local insights database

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run tests
npm test
```