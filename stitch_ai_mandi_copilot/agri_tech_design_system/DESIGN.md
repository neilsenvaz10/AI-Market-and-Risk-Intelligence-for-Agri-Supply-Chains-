---
name: Agri-Tech Design System
colors:
  surface: '#f6fbf1'
  surface-dim: '#d6dcd2'
  surface-bright: '#f6fbf1'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f5eb'
  surface-container: '#eaefe6'
  surface-container-high: '#e5eae0'
  surface-container-highest: '#dfe4da'
  on-surface: '#181d17'
  on-surface-variant: '#414941'
  inverse-surface: '#2c322b'
  inverse-on-surface: '#edf2e8'
  outline: '#727970'
  outline-variant: '#c1c9be'
  surface-tint: '#3b6845'
  primary: '#00260d'
  on-primary: '#ffffff'
  primary-container: '#0f3d1e'
  on-primary-container: '#79a980'
  inverse-primary: '#a1d2a7'
  secondary: '#086d39'
  on-secondary: '#ffffff'
  secondary-container: '#9df6b4'
  on-secondary-container: '#15733f'
  tertiary: '#132500'
  on-tertiary: '#ffffff'
  tertiary-container: '#223c00'
  on-tertiary-container: '#78ad36'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#bdefc2'
  primary-fixed-dim: '#a1d2a7'
  on-primary-fixed: '#00210b'
  on-primary-fixed-variant: '#23502f'
  secondary-fixed: '#9df6b4'
  secondary-fixed-dim: '#82d99a'
  on-secondary-fixed: '#00210d'
  on-secondary-fixed-variant: '#005229'
  tertiary-fixed: '#baf474'
  tertiary-fixed-dim: '#9fd75b'
  on-tertiary-fixed: '#102000'
  on-tertiary-fixed-variant: '#2f4f00'
  background: '#f6fbf1'
  on-background: '#181d17'
  surface-variant: '#dfe4da'
typography:
  headline-xl:
    fontFamily: Barlow Condensed
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 42px
  headline-lg:
    fontFamily: Barlow Condensed
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 34px
  headline-md:
    fontFamily: Barlow Condensed
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: Noto Sans Devanagari
    fontSize: 15px
    fontWeight: '500'
    lineHeight: 22px
  label-md:
    fontFamily: Noto Sans Devanagari
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.5rem
  margin: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system embodies a modern agri-tech identity, bridging advanced agricultural science with practical, field-ready utility. The brand personality is rooted, innovative, reliable, and optimistic. The target audience includes modern farmers, agricultural extension officers, supply chain operators, and enterprise agronomists who require instant clarity under varying outdoor lighting conditions.

The UI employs a **Corporate / Modern** style fused with clean minimalism. It avoids excessive ornamentation in favor of high-legibility data density, structured cards, and purposeful color accents that guide the user through crop monitoring, yield prediction, and resource management tasks efficiently.

## Colors

The color palette is derived directly from the agricultural landscape, anchored by a commanding deep forest green for primary navigation and structure, complemented by active leaf green and energetic lime accents. 

- **Primary (`#0F3D1E`):** Deep forest green utilized for high-emphasis actions, top-level branding, and primary headers.
- **Secondary (`#1F7A45`):** Leaf green designated for interactive states, active filters, and positive indicators.
- **Tertiary (`#A8E063`):** Lime accent used sparingly for highlights, data visualization graphs, and call-to-action badges.
- **Neutral Background (`#F3F8EE`):** A clean, mint-tinted white canvas that reduces glare in outdoor environments while maintaining high contrast against cards (`#FFFFFF`).
- **Text (`#10261A`):** Deep earthy charcoal for maximum readability on light surfaces.
- **Muted Text (`#5B6E62`):** Desaturated olive-gray for secondary metadata, captions, and inactive elements.
- **Feedback Colors:** Sunflower yellow (`#F5B800`) for notices, warning amber (`#F59E0B`) for caution states, and danger red (`#D93025`) for critical alerts such as irrigation failures or pest outbreaks.

## Typography

Typography establishes a strict hierarchy optimized for data-dense dashboards and mobile field use. **Barlow Condensed** provides industrial strength and space efficiency for large metrics and section headers. **Inter** delivers neutral, highly legible sans-serif readability for data tables and body copy. **Noto Sans Devanagari** ensures seamless localization and uncompromised rendering for Marathi and Hindi regional interfaces.

Ensure that all localized strings inherit appropriate line-height adjustments to accommodate vowel marks without clipping.

## Layout & Spacing

This design system uses a responsive **fluid grid** system configured around a 12-column layout for desktop environments, scaling down to a flexible 4-column layout for mobile devices. 

- **Gutters:** Maintain a consistent 1.5rem spacing between grid columns to cleanly separate field data modules.
- **Margins:** Outer canvas margins scale from 1rem on mobile to 2.5rem on desktop viewports.
- **Rhythm:** Spacing tokens must be applied strictly to component padding and layout gaps following an 8px base grid multiplier.

On mobile form factors, collapse secondary metric columns into horizontal swipeable carousels to preserve vertical scanning flow for field workers.

## Elevation & Depth

Visual hierarchy is communicated primarily through **tonal layers** and subtle **ambient shadows** rather than heavy borders. 

- **Surfaces:** The base canvas sits at the lowest tier (`#F3F8EE`), while interactive cards and containers rest on crisp white (`#FFFFFF`) surfaces.
- **Shadows:** Use ultra-soft, diffused shadows tinted with low-opacity forest green (`#0F3D1E` at 8% opacity) to give cards a natural, lifted feel without looking heavy or skeuomorphic. 
- **Interactive States:** Hover and active states elevate cards by shifting shadow blur radii upward while introducing a thin low-contrast outline in secondary green.

## Shapes

The design system employs a **Soft** shape language (`roundedness`: 1) featuring gentle 0.25rem to 0.5rem corner radii. This strikes a balance between industrial efficiency and organic approachability.

- **Buttons & Inputs:** Standardize on 0.375rem border-radius to maintain quick touch targets without sacrificing screen real estate.
- **Cards & Containers:** Utilize 0.5rem (`rounded-lg`) for structural modules, keeping corners slightly softened to match the organic nature of agriculture while preserving a structured, professional dashboard aesthetic.

## Components

All components must leverage the defined tokens for color, typography, and shape to ensure consistency across web and mobile platforms.

- **Buttons:** Primary buttons utilize the deep forest green (`#0F3D1E`) background with white text and a soft 0.375rem radius. Secondary buttons feature a transparent background with a leaf green (`#1F7A45`) border and text.
- **Chips & Tags:** Pill-shaped or softly rounded elements used for crop status, soil moisture levels, and weather tags. Backgrounds utilize light lime tints with dark green text.
- **Lists:** Structured with clear vertical padding, high-contrast primary text, and muted secondary metadata. Include a 1px divider using desaturated neutral borders.
- **Checkboxes & Radio Buttons:** Designed with distinct geometry—square checkboxes with 0.125rem radius and circular radio items, highlighted in leaf green when selected.
- **Input Fields:** Outlined text fields featuring a neutral border, 0.375rem radius, and clear internal padding. Focus states instantly transition the border to leaf green with a subtle ambient glow.
- **Cards:** White (`#FFFFFF`) background containers with soft elevation shadows, used to group telemetry, weather forecasts, and field maps.
- **Specialized Components:** Include weather condition widgets, soil sensor gauges, yield prediction progress bars, and quick-action emergency broadcast banners for frost or pest warnings.