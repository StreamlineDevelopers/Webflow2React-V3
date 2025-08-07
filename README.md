# HTML to Smart React Components Converter

> A command-line tool to automatically convert a directory of static HTML files into a structured, component-based React application.

This tool analyzes your HTML to identify layouts and repeating elements, extracting them into individual JSX components with props. It intelligently handles assets like SVGs and ensures the generated code is clean, formatted, and ready for development.

## Key Features

-   **Automatic Componentization**: Detects repetitive blocks of HTML and extracts them into reusable React components.
-   **Intelligent Prop Generation**: Creates props for dynamic content such as text, links, and image sources that differ between component instances.
-   **Smart SVG Handling**: Automatically detects `<svg>` tags, saves them as external `.svg` files in a public directory, and replaces them with an `<img>` tag pointing to the new file.
-   **Flexible Configuration**: Easily customize paths, component detection rules, and code formatting through a central `config.json` file.
-   **Code Formatting**: Uses Prettier to automatically format all generated `.jsx` files for consistency and readability.

## How It Works

The conversion is a two-step process:

1.  **Parse to AST (`index.js`)**: First, the script reads all `.html` files from the input directory (specified in `config.json`). It uses `htmlparser2` to parse each file into an Abstract Syntax Tree (AST), which is a structured JSON representation of the HTML. These ASTs are saved to an intermediate directory.

2.  **Convert to React (`converter.js`)**: Second, the main script reads the generated ASTs. It analyzes the structure to find reusable "component candidates" based on rules in your configuration, generates props for them, and then writes the final `.jsx` files for both components and pages into the configured output directory.

---

## Configuration (`config.json`)

The entire conversion process is controlled by a `config.json` file located in the `scripts` directory. This allows you to easily adapt the tool to different project structures and change component detection behavior without modifying the source code.

Here is the default configuration structure:

```json
{
  "paths": {
    "htmlInput": "../html",
    "asts": "../asts",
    "reactOutput": "./react_output",
    "components": "components",
    "pages": "pages",
    "public": "public",
    "svgs": "svgs"
  },
  "componentization": {
    "minChildrenForRepetition": 2,
    "minRepetitionsForComponent": 2,
    "layoutIdentifiers": [
      "navbar", "footer", "sidebar", "main-content", "container"
    ],
    "selfClosingTags": [
      "img", "br", "hr", "input", "meta", "link", "area", "base", "col",
      "embed", "param", "source", "track", "wbr"
    ]
  },
  "formatting": {
    "prettier": {
      "parser": "babel",
      "tabWidth": 2,
      "semi": true,
      "singleQuote": true
    }
  }
}
```

-   **`paths`**: Defines all the input and output directories. All paths are relative to the `scripts` directory.
-   **`componentization`**: Controls how the script identifies components.
    -   `minRepetitionsForComponent`: The number of times a structurally identical element must appear to be considered a reusable component.
    -   `layoutIdentifiers`: A list of class names or IDs that the script should treat as major layout components (e.g., 'navbar', 'footer').
-   **`formatting.prettier`**: An object containing Prettier formatting options to ensure your generated code is clean and consistent.

---

## Getting Started

Follow these steps to set up and run the converter.

### 1. Prerequisites

Make sure you have [Node.js](https://nodejs.org/) (version 14 or higher) and npm installed on your machine.

### 2. Directory Structure

Your project should be organized with the following directory structure. The scripts and their configuration live in a `scripts` folder.

```
project-root/
│
├── html/
│   ├── index.html
│   ├── about.html
│   └── contact.html
│
├── scripts/
│   ├── converter.js
│   ├── index.js
│   └── config.json   <-- Your configuration file
│
├── package.json
└── ...
```

-   **`html/`**: The default input directory for your source `.html` files. You can change this in `config.json`.
-   **`scripts/`**: This is where the conversion scripts and their configuration live.

### 3. Installation

The scripts rely on a few Node.js packages.

First, create a `package.json` file if you don't have one:
```bash
npm init -y
```

Next, install the required dependencies:
```bash
npm install fs-extra htmlparser2 prettier dom-serializer
```
Your `package.json` will now include these packages in its `dependencies`.

### 4. Create the Configuration File

Before running the scripts, you must create the configuration file.

1.  In your `scripts` folder, create a new file named `config.json`.
2.  Copy and paste the default configuration from the **Configuration** section above into this new file.
3.  Adjust the paths and rules as needed for your project.

### 5. Usage

The conversion process is run from the command line in two steps. The scripts will automatically use the settings from your `config.json`.

#### **Step 1: Generate the ASTs**

This command reads the files in your configured `htmlInput` directory and creates the intermediate `.json` files in your configured `asts` directory.

```bash
node scripts/index.js
```You will see output confirming that each HTML file has been processed.

#### **Step 2: Generate the React Components**

This command reads the ASTs and generates the final React project in your `reactOutput` directory.

```bash
node scripts/converter.js
```
The console will log the creation of each new component and page.

---

## Output

After running the scripts, the `react_output` directory (or whatever you named it in `config.json`) will be created inside your `scripts` folder. It will have the following structure:

```
scripts/
│
└── react_output/
    │
    ├── components/
    │   ├── ReusableItem.jsx
    │   └── ... (all other reusable components)
    │
    ├── pages/
    │   ├── Index.jsx
    │   └── ... (all your main page components)
    │
    └── public/
        └── svgs/
            ├── icon-xxxxxxxx.svg
            └── ... (all extracted SVG files)
```

The names of the `components`, `pages`, `public`, and `svgs` directories are all defined in your `config.json`. You can now take the contents of this output directory and integrate them into a React project (e.g., one created with Create React App or Vite).