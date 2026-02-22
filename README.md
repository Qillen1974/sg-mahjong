# Singapore Mahjong Game

A TypeScript-based implementation of Singapore Mahjong (also known as Singaporean Mahjong or "Siam Mahjong").

## Overview

This project is a digital recreation of Singapore Mahjong, a popular variant of the classic Chinese tile game. Singapore Mahjong differs from other variants in its scoring system, hand requirements, and specific rules.

## Game Features

- Full Singapore Mahjong ruleset
- Tile-based gameplay with 144 tiles
- Scoring system based on Singapore Mahjong conventions
- 4-player multiplayer support
- TypeScript implementation for type safety and maintainability

## Tech Stack

- **Language**: TypeScript
- **Runtime**: Node.js
- **Package Manager**: npm

## Getting Started

### Prerequisites

- Node.js (v18+)
- npm

### Installation

```bash
npm install
```

### Build

```bash
npm run build
```

### Run

```bash
npm start
```

## Project Structure

```
singapore-mahjong/
├── src/
│   └── index.ts       # Entry point
├── package.json       # Project metadata
├── tsconfig.json      # TypeScript configuration
└── README.md          # This file
```

## How to Play

Singapore Mahjong is played with 4 players. The game uses 144 tiles consisting of:

- **Suits**: Dots (Circles), Bamboo (Sticks), Characters (Numbers) - 9 tiles each (×4 = 108 tiles)
- **Honors**: Winds (East, South, West, North) and Dragons (Red, Green, White) - 7 types (×4 = 28 tiles)
- **Flowers**: 4 tiles (1 of each)
- **Seasons**: 4 tiles (1 of each)

The objective is to form complete hands (melds) and score points.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT License
