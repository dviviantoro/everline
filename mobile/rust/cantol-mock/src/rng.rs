/// xorshift64*: small, fast and reproducible. Not for anything security related.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        // A zero state would stay zero forever.
        Rng(seed | 1)
    }

    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform in `lo..=hi`.
    pub fn range(&mut self, lo: u32, hi: u32) -> u32 {
        lo + (self.next_u64() % (u64::from(hi - lo) + 1)) as u32
    }

    /// True with probability `pct` percent.
    pub fn chance_pct(&mut self, pct: f64) -> bool {
        if pct <= 0.0 {
            return false;
        }
        let unit = (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64;
        unit * 100.0 < pct
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_sequence() {
        let (mut a, mut b) = (Rng::new(7), Rng::new(7));
        assert!((0..20).all(|_| a.next_u64() == b.next_u64()));
    }

    #[test]
    fn range_is_inclusive_and_chance_is_roughly_calibrated() {
        let mut r = Rng::new(3);
        assert!((0..1000).all(|_| (5..=9).contains(&r.range(5, 9))));
        let hits = (0..20_000).filter(|_| r.chance_pct(25.0)).count();
        assert!((4_000..6_000).contains(&hits), "{hits}");
        assert!(!r.chance_pct(0.0));
    }
}
