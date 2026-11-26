# ggplot2 reference: geom_freqpoly with after_stat(density)
ggplot(diamonds, aes(price, after_stat(density), colour = cut)) +
  geom_freqpoly(binwidth = 500)
