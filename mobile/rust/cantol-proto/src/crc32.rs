//! CRC-32 (IEEE 802.3, the same polynomial as zlib), table driven.

const fn make_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut c = i as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 {
                0xEDB8_8320 ^ (c >> 1)
            } else {
                c >> 1
            };
            k += 1;
        }
        table[i] = c;
        i += 1;
    }
    table
}

static TABLE: [u32; 256] = make_table();

/// CRC-32 of `data`.
pub fn crc32(data: &[u8]) -> u32 {
    crc32_update(0, data)
}

/// Continue a CRC-32 over more data: `crc32_update(crc32(a), b) == crc32(a ++ b)`.
pub fn crc32_update(previous: u32, data: &[u8]) -> u32 {
    let mut c = !previous;
    for &b in data {
        c = TABLE[((c ^ u32::from(b)) & 0xFF) as usize] ^ (c >> 8);
    }
    !c
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_check_value() {
        // The published CRC-32 check value for the ASCII string "123456789".
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn empty_input_is_zero() {
        assert_eq!(crc32(b""), 0);
    }

    #[test]
    fn update_is_incremental() {
        let whole = crc32(b"hello, red pitaya");
        let split = crc32_update(crc32(b"hello, "), b"red pitaya");
        assert_eq!(whole, split);
    }
}
