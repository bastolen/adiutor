/**
 * @file Branding on the server (decisions 0049, 0050 and 0051): the brand
 * colours a staff Admin chose, read for every page and email, and saved from
 * the Appearance tab of Settings, the staff's name every text shows, and the
 * logo and browser tab icon a staff Admin uploads there. This
 * is the module's public API; the code lives in the files next to it, and
 * nothing outside this folder imports them directly.
 *
 * It imports no server-only code, so the emails Better Auth sends can load it.
 */
export {
  type BrandImageFacts,
  type BrandImages,
  loadBrandImage,
  loadBrandImages,
  removeBrandImage,
  setBrandImage,
} from './brand-images';
export { type BrandColoursInput, getBrandColours, setBrandColours } from './colour-settings';
export { default as loadBrandColours } from './colours';
export { default as loadEmailBrand } from './email-brand';
export { default as pageBrandCss } from './page-colours';
export { default as requestStaffName } from './page-name';
