import * as vscode from "vscode";
import {TextDocument, Position, Selection} from "vscode";
import {Extension} from "./extension";

type Block = {
    line: number,
    startChar: number,
    endChar: number,
    startCol: number,
    endCol: number,
};

function positionToColumn(doc:TextDocument, tab:number, pos:Position) {
    const lineText = doc.lineAt(pos.line).text;
    let col = 0;
    for (let i = 0; i < pos.character; i++) {
        const codePoint = lineText.codePointAt(i);
        if (codePoint !== undefined) {
            if (codePoint > 0xffff)
                ++i;
            col += codePoint === 9 ? tab - (col % tab) : 1;
        }

    }

    return col;
}
function columnToPosition(doc:TextDocument, tab:number, line:number, col:number) {
    const lineText = doc.lineAt(line).text;
    let i = 0;
    for (let currentCol = 0; currentCol < col && i < lineText.length; i++) {
        const codePoint = lineText.codePointAt(i);
        if (codePoint !== undefined) {
            if (codePoint > 0xffff)
                ++i;

            currentCol += codePoint === 9 ? tab - (currentCol % tab) : 1;
        }
    }

    return new Position(line, i - 1);
}


function createSpaceInsert(line: number, startChar: number, startCol: number, dist: number, tab: number) {
    if (tab) {
        const endCol = startCol + dist;
        const firstTab = Math.floor((startCol + tab - 1) / tab);
        const lastTab = Math.floor(endCol / tab);
        return {
            pos: new vscode.Position(line, startChar),
            str: ' '.repeat(firstTab * tab - startCol) + '\t'.repeat(lastTab - firstTab) + ' '.repeat(endCol - lastTab * tab)
        };
    } else {
        return {
            pos: new vscode.Position(line, startChar),
            str: ' '.repeat(dist)
        };
    }
}

function createInsertsFromAlignBlocks(alignBlocks: Block[], targetStartCol: number, targetLength: number, tab: number) {
    const spaceInserts = [];

    // create space inserts for each align block
    for (const i of alignBlocks) {
        const alignBlockLength = i.endCol - i.startCol;

        const startDist = targetStartCol - i.startCol;
        const endDist = targetLength - alignBlockLength;

        if (startDist > 0) {
            // insert spaces before the align block to align the left side
            spaceInserts.push(createSpaceInsert(i.line, i.startChar, i.startCol, startDist, tab));
        }
        if (endDist > 0) {
            // insert spaces after the align block to align the right side
            spaceInserts.push(createSpaceInsert(i.line, i.endChar, i.endCol, endDist, tab));
        }
    }

    return spaceInserts;
}

function createAlignBlock(doc:TextDocument, tab:number, start:Position, end:Position) : Block {
    return {
        line: start.line,
        startChar: start.character,
        endChar: end.character,
        startCol: positionToColumn(doc, tab, start),
        endCol: positionToColumn(doc, tab, end),
    };
}

function combineAlignBlocks(a: Block, b: Block) {
    return {
        line: a.line,
        startChar: Math.min(a.startChar, b.startChar),
        endChar: Math.max(a.endChar, b.endChar),
        startCol: Math.min(a.startCol, b.startCol),
        endCol: Math.max(a.endCol, b.endCol),
    };
}

function createAlignBlocksFromSelections(doc: TextDocument, tab:number, selections:readonly Selection[]) {
    const alignBlocks = [];

    // create align blocks for each selection
    for (const i of selections) {
        if (i.isSingleLine) {
            // create one block for single-line selections
            alignBlocks.push(createAlignBlock(doc, tab, i.start, i.end));
        }
        else {
            // create two blocks 0-length blocks at the start and end for multi-line selections
            alignBlocks.push(createAlignBlock(doc, tab, i.start, i.start));
            alignBlocks.push(createAlignBlock(doc, tab, i.end, i.end));
        }
    }

    return Object.values(alignBlocks.reduce((prev, i) => {
        const j = prev[i.line];
        prev[i.line] = j ? combineAlignBlocks(j, i) : i;
        return prev;
    }, {} as Record<number, Block>));
}

export function alignCursors() {
    const textEditor = vscode.window.activeTextEditor;
    if (!textEditor)
        return;

    const options = textEditor.options;
    const tab = options.insertSpaces ? 0 : textEditor.options.tabSize as number;

    // get all the blocks of text that will be aligned from the selections
    const alignBlocks = createAlignBlocksFromSelections(textEditor.document, tab, textEditor.selections);
    if (alignBlocks.length < 2) {
        return;
    }

    const targetStartCol    = alignBlocks.reduce((prev, i) => Math.max(prev, i.startCol), 0);
    const targetLength      = alignBlocks.reduce((prev, i) => Math.max(prev, i.endCol - i.startCol), 0);

    // calculate where we should insert spaces
    const spaceInserts = createInsertsFromAlignBlocks(alignBlocks, targetStartCol, targetLength, tab);
    if (spaceInserts.length === 0) {
        return;
    }

    // NOTE: I'm really not sure how the undo system works. Especially regarding
    // selections.
    // 
    // For example, if you undo and redo a command, the text changes are undone and
    // redone correctly, but the selections are not. The selections do not change
    // when you redo the command. However, if you put a second edit at the end of
    // your command, this fixes the issue (even if the edit does not do anything).
    // 
    // Also, if we do 2 edits and either one or both of the edits create an
    // undo stop, then 2 undos are required to completely undo the command.
    // However, if neither edit creates an undo stop, then 1 undo is required to
    // completely undo the command.

    // start the edit
    textEditor.edit(textEditorEdit => {
        // insert all of the spaces
        spaceInserts.forEach(spaceInsert => textEditorEdit.insert(spaceInsert.pos, spaceInsert.str));
    }, { undoStopBefore: false, undoStopAfter: false }) // don't create an undo after (before does not seem to matter)
        .then(() => {
            // select all the aligned blocks
            textEditor.selections = alignBlocks.map(i => {
                const start = columnToPosition(textEditor.document, tab, i.line, targetStartCol);
                const end   = columnToPosition(textEditor.document, tab, i.line, targetStartCol + targetLength);
                return new vscode.Selection(start.line, start.character, end.line, end.character);
            });

            textEditor.edit(textEditorEdit => {
                // noop
            }, { undoStopBefore: false, undoStopAfter: false });  // don't create an undo stop before (after does not seem to matter)
        }, err => {
            throw err;
        });
}
