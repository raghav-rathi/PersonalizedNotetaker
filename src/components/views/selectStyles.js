import { css } from '../../assets/lit-core-2.7.4.min.js';

// A native dropdown list is a separate OS window, so screen sharing shows it although the app window is
// hidden from capture. base-select draws the list inside the app window instead, with the same keys.
// Every <select> in the app must get these styles.
export const inPageSelectStyles = css`
    select,
    select::picker(select) {
        appearance: base-select;
    }

    select::picker-icon {
        display: none;
    }

    select::picker(select) {
        margin-block: 4px;
        padding: 4px;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-md);
        /* The theme colors can be see-through; the open list stays solid so it reads over the page. */
        background: rgb(from var(--bg-elevated) r g b / 1);
        color: var(--text-primary);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    }

    select option {
        padding: 6px 10px;
        border-radius: var(--radius-sm);
        font-size: var(--font-size-sm);
    }

    select option:hover,
    select option:focus-visible {
        background: rgb(from var(--bg-hover) r g b / 1);
        outline: none;
    }
`;
