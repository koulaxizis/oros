# ICC profiles in orOS (vendor/icc) — origin and terms

Used by orOS Layout's PDF/X-4 export (designkit/pdfx.js, LY-PRO W1): the
print profile is embedded as the OutputIntent, sRGB tags the RGB colours
and pictures. Both files are unmodified copies, taken from
`@imgly/plugin-print-ready-pdfs-web@1.86.2/dist/` (npm), which already
redistributes them. orOS is free and charges nothing for them.

| File | SHA-256 | Origin | Licence |
| --- | --- | --- | --- |
| `ISOcoated_v2_eci.icc` | `128dc02f7246cc3807af0323695379f64151a8f27a587736acc59f8b6ce894b8` | ECI European Color Initiative, <https://www.eci.org/en/downloads> (ECI Offset 2009, Coated FOGRA39), made with Heidelberg PrintOpen | HEIDELBERG licence (below) |
| `sRGB_IEC61966-2-1.icc` | `3f6a7ffece56fe0fba8e36d4f581976a12896cf1b34fdaf3f00c7dddea67f460` | Hewlett-Packard / ICC, <https://color.org/srgbprofiles.xalter> | sRGB profile licence (below) |

The HEIDELBERG licence requires the profile to be distributed together with
its licence text, so this file ships next to the profile.

## HEIDELBERG licence (`ISOcoated_v2_eci.icc`)

Text as recorded in Debian's `icc-profiles` 2.1-2 `debian/copyright`, which covers `ISOcoated_v2_eci.icc`:

> License terms ("LICENSE") for the use of HEIDELBERG ICC profiles with profile
> properties as defined in this license
>
> 1 Definition
> 1.1 For generic ICC profiles for the profiling of standard printing conditions
> which have been produced with software of Heidelberger Druckmaschinen AG
> ("HEIDELBERG") ("PROFILES"), HEIDELBERG agrees to a free distribution and use
> of the PROFILES, on condition that the distributor and/or user ("LICENSEE")
> agrees to the following terms.
> 1.2 Standard printing conditions within the meaning of this LICENSE are
> standards defined by international or national standardization bodies such as
> ISO 12647 and the respective parts thereof or are a de facto standards in
> certain regions of the world.
>
> 2 Scope of the Right of Use
> 2.1 HEIDELBERG grants the LICENSEE a non-exclusive right to use the PROFILES.
> 2.2 The LICENSEE is allowed to redistribute the PROFILES and to transfer this
> Right of Use to a third party on condition that these PROFILES are always
> distributed together with this LICENSE and that the third party accepts that
> the license transferred by the LICENSEE is subject to the terms of this
> LICENSE. The PROFILES may be redistributed also bundled together with other
> software.
>
> 3 Exclusion of other Use
> 3.1 It is explicitly prohibited to charge any kind of remuneration for the
> distribution of these PROFILES.
> 3.2 It is not allowed to edit these PROFILES or to change the entries in the
> profile tags or to use the inherent technical solutions for any purpose other
> than the actual purpose of an ICC profile. If the PROFILES will be sold
> bundled together with commercial software, then it is not allowed to charge an
> extra price for the PROFILES.
>
> 4 Warranty and Liability
> 4.1 The PROFILES are provided "as is" free of charge and devoid of all claims
> against HEIDELBERG or the distributor of these PROFILES.
> 4.2 This LICENSE excludes all liability, including the liability for damages.
>
> 5 Copyright
> The copyright on the PROFILES remains with HEIDELBERG.
>
> 6 General Terms
> 6.1 The Right of Use as described in point 2.1 is void with immediate effect
> upon violation of this LICENSE.
> 6.2 This LICENSE applies explicitly to generic profiles only for the profiling
> of printing standards, as specified in point 1. This LICENSE expressly does
> not apply to profiles produced with HEIDELBERG software which profile the
> properties of a specific device.
>
> Heidelberg, September 2003

## sRGB profile licence (`sRGB_IEC61966-2-1.icc`)

> To anyone who acknowledges that the file "sRGB Color Space Profile.icm" is
> provided "AS IS" WITH NO EXPRESS OR IMPLIED WARRANTY: permission to use, copy
> and distribute this file for any purpose is hereby granted without fee,
> provided that the file is not changed including the HP copyright notice tag,
> and that the name of Hewlett-Packard Company not be used in advertising or
> publicity pertaining to distribution of the software without specific, written
> prior permission. Hewlett-Packard Company makes no representations about the
> suitability of this software for any purpose.
