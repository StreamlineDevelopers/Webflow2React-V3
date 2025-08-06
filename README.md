# HTML to Smart React Components Converter

> A command-line tool to automatically convert a directory of static HTML files into a structured, component-based React application.

This tool analyzes your HTML to identify layouts and repeating elements, extracting them into individual JSX components with props. It intelligently handles assets like SVGs and ensures the generated code is clean, formatted, and ready for development.

## Key Features

-   **Automatic Componentization**: Detects repetitive blocks of HTML and extracts them into reusable React components.
-   **Intelligent Prop Generation**: Creates props for dynamic content such as text, links, and image sources that differ between component instances.
-   **Smart SVG Handling**: Automatically detects `<svg>` tags, saves them as external `.svg` files in a public directory, and replaces them with an `<img>` tag pointing to the new file. This is great for performance and asset management.
-   **Safe Attribute Handling**: Correctly formats prop values, including those with special characters like double quotes, to prevent syntax errors in JSX.
-   **Code Formatting**: Uses Prettier to automatically format all generated `.jsx` files for consistency and readability.

## How It Works

The conversion is a two-step process:

1.  **Parse to AST (`index.js`)**: First, the script reads all `.html` files from the `html` directory. It uses `htmlparser2` to parse each file into an Abstract Syntax Tree (AST), which is a structured JSON representation of the HTML. These ASTs are saved as `_ast.json` files in the `asts` directory.

2.  **Convert to React (`converter.js`)**: Second, the main script reads the generated `_ast.json` files. It analyzes the structure to find reusable "component candidates," generates props for them, and then writes the final `.jsx` files for both the reusable components and the main pages into the `react_output` directory.

---

## Getting Started

Follow these steps to set up and run the converter.

### 1. Prerequisites

Make sure you have [Node.js](https://nodejs.org/) (version 14 or higher) and npm installed on your machine.

### 2. Directory Structure

Your project should be organized with the following directory structure. The scripts assume they are located in a `scripts` folder.

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
│   └── index.js
│
├── package.json
└── ...
```

-   **`html/`**: **This is where you must place all your source `.html` files.**
-   **`scripts/`**: This is where the conversion scripts (`index.js` and `converter.js`) live.

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

### 4. Usage

The conversion process is run from the command line in two steps.

#### **Step 1: Generate the ASTs**

This command reads the files in the `html` directory and creates the intermediate `.json` files in a new `asts` directory.

```bash
node scripts/index.js```
You will see output confirming that each HTML file has been processed.

#### **Step 2: Generate the React Components**

This command reads the ASTs and generates the final React project.

```bash
node scripts/converter.js
```
The console will log the creation of each new component and page.

---

## Output

After running the scripts, a new directory named `react_output` will be created inside your `scripts` folder. It will have the following structure:

```
scripts/
│
└── react_output/
    │
    ├── components/
    │   ├── ReusableItem.jsx
    │   ├── SidemenuItem.jsx
    │   └── ... (all other reusable components)
    │
    ├── pages/
    │   ├── Index.jsx
    │   ├── About.jsx
    │   └── ... (all your main page components)
    │
    └── public/
        └── svgs/
            ├── icon-xxxxxxxx.svg
            └── ... (all extracted SVG files)
```

You can now take the contents of the `react_output` directory and integrate them into a React project (e.g., one created with Create React App or Vite).